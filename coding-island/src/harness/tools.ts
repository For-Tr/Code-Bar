import { invoke } from "@tauri-apps/api/core";
import type { HarnessTool, ToolCall, ToolResult } from "./types";
import type { HarnessPermissions } from "../store/settingsStore";

// ── 工具定义 ─────────────────────────────────────────────────

export const HARNESS_TOOLS: HarnessTool[] = [
  {
    name: "read_file",
    description: "读取指定路径的文件内容。路径相对于工作目录。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径（相对于工作目录）" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "写入内容到指定路径的文件。如果文件不存在则创建，存在则覆盖。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径（相对于工作目录）" },
        content: { type: "string", description: "要写入的完整文件内容" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "列出目录内容。路径相对于工作目录。",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "目录路径（相对于工作目录），留空则列出根目录",
        },
      },
      required: [],
    },
  },
  {
    name: "run_command",
    description: "在工作目录执行 Shell 命令，返回 stdout 和 stderr。",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的 shell 命令" },
      },
      required: ["command"],
    },
  },
  {
    name: "get_git_diff",
    description: "获取工作目录的 git diff，查看未提交的变更。",
    input_schema: {
      type: "object",
      properties: {
        staged: {
          type: "boolean",
          description: "是否获取暂存区的 diff（默认 false，获取工作区 diff）",
        },
      },
      required: [],
    },
  },
];

// ── 工具执行器 ───────────────────────────────────────────────

export async function executeTool(
  call: ToolCall,
  workdir: string,
  permissions: HarnessPermissions,
  onOutput: (line: string) => void
): Promise<ToolResult> {
  const err = (msg: string): ToolResult => ({
    tool_use_id: call.id,
    content: `Error: ${msg}`,
    is_error: true,
  });

  const ok = (content: string): ToolResult => ({
    tool_use_id: call.id,
    content,
  });

  try {
    switch (call.name) {
      case "read_file": {
        if (!permissions.allowReadFiles) return err("无读取文件权限");
        const path = call.input.path as string;
        onOutput(`📖 读取文件: ${path}`);
        const content = await invoke<string>("harness_read_file", { workdir, path });
        return ok(content);
      }

      case "write_file": {
        if (!permissions.allowWriteFiles) return err("无写入文件权限");
        const path = call.input.path as string;
        const content = call.input.content as string;
        if (permissions.confirmBeforeWrite) {
          const confirmed = await invoke<boolean>("harness_confirm", {
            title: "写入文件",
            message: `确认写入文件：${path}（${content.split("\n").length} 行）`,
          });
          if (!confirmed) return err("用户取消了写入操作");
        }
        onOutput(`✏️  写入文件: ${path}`);
        await invoke("harness_write_file", { workdir, path, content });
        return ok(`成功写入 ${path}`);
      }

      case "list_directory": {
        const path = (call.input.path as string) || ".";
        onOutput(`📂 列出目录: ${path}`);
        const entries = await invoke<string[]>("harness_list_dir", { workdir, path });
        return ok(entries.join("\n"));
      }

      case "run_command": {
        if (!permissions.allowRunCommands) return err("无执行命令权限");
        const command = call.input.command as string;
        if (permissions.confirmBeforeRun) {
          const confirmed = await invoke<boolean>("harness_confirm", {
            title: "执行命令",
            message: `确认执行：${command}`,
          });
          if (!confirmed) return err("用户取消了命令执行");
        }
        onOutput(`⚡ 执行: ${command}`);
        const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
          "harness_run_command",
          { workdir, command }
        );
        const combined =
          (result.stdout || "") +
          (result.stderr ? `\n[stderr]\n${result.stderr}` : "") +
          `\n[exit: ${result.exit_code}]`;
        return ok(combined);
      }

      case "get_git_diff": {
        const staged = (call.input.staged as boolean) ?? false;
        onOutput(`🔍 获取 git diff${staged ? " (staged)" : ""}`);
        const diff = await invoke<string>("harness_git_diff", { workdir, staged });
        return ok(diff || "(无变更)");
      }

      default:
        return err(`未知工具: ${call.name}`);
    }
  } catch (e) {
    return err(String(e));
  }
}

// ── 按权限过滤工具列表 ────────────────────────────────────────

export function getAvailableTools(permissions: HarnessPermissions): HarnessTool[] {
  return HARNESS_TOOLS.filter((t) => {
    if (t.name === "read_file" && !permissions.allowReadFiles) return false;
    if (t.name === "write_file" && !permissions.allowWriteFiles) return false;
    if (t.name === "run_command" && !permissions.allowRunCommands) return false;
    return true;
  });
}
