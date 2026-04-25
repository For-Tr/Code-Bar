<p align="center">
  <img src="apps/desktop/src-tauri/icons/128x128.png" alt="Code Bar" width="104" height="104">
</p>

<h1 align="center">Code Bar</h1>

<p align="center">
  <strong>并行 AI 编程，不再把仓库搞乱。</strong>
  <br>
  一个面向 Claude Code 和 Codex 的桌面工作台。
  <br>
  在多个仓库里并行运行编码会话，为每个会话自动创建独立 git worktree，并在一个界面里完成终端、编辑器、SCM 和 diff 工作流。
  <br><br>
  <a href="./README.md">English</a> | <strong>简体中文</strong>
</p>

<p align="center">
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest"><img src="https://img.shields.io/github/v/release/For-Tr/Code-Bar?style=flat-square&label=release&color=blue" alt="最新版本"></a>
  <a href="https://github.com/For-Tr/Code-Bar/stargazers"><img src="https://img.shields.io/github/stars/For-Tr/Code-Bar?style=flat-square&color=yellow" alt="Stars"></a>
  <a href="https://github.com/For-Tr/Code-Bar/releases"><img src="https://img.shields.io/github/downloads/For-Tr/Code-Bar/total?style=flat-square&label=downloads" alt="下载量"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/For-Tr/Code-Bar?style=flat-square" alt="许可证"></a>
</p>

<p align="center">
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-windows-x64.msi">Windows</a> ·
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-macos-apple-silicon.dmg">macOS Apple Silicon</a> ·
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-macos-intel.dmg">macOS Intel</a>
</p>

<p align="center">
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest">下载</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能特性">功能特性</a> ·
  <a href="#从源码构建">从源码构建</a> ·
  <a href="https://github.com/For-Tr/Code-Bar/stargazers">Star</a>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/483c38de-69ed-4c90-9cb5-8548aa37fec2" alt="Code Bar 演示" width="960" />
</p>

## 为什么是 Code Bar

AI 编程一旦并行起来，很快就会变乱：终端标签太多、分支互相污染、改动也没有一个顺手的地方统一查看。

Code Bar 把每个任务放进独立 session 和 git worktree，让你能并行运行 AI 工作流，同时保持可控。

- 并行运行多个 Claude Code 或 Codex 会话
- 为每个会话自动创建独立 git worktree
- 在一个应用里完成终端、文件浏览、编辑、SCM 和 diff 审阅
- 在可恢复时继续已绑定的 Claude Code / Codex 原生会话
- 为支持的 runner 提供通知与 hooks 集成

## 适合谁

- Claude Code 和 Codex 的重度用户
- 需要跨多个仓库工作的全栈开发者
- 想更安全地并行使用 AI 辅助编程的开发者
- 希望围绕终端型 AI 工具建立桌面工作流的用户

<p align="center">
  <img src="https://github.com/user-attachments/assets/c030fa66-e6ea-4274-a15d-0e2fb499a58b" alt="Code Bar 截图" width="960" />
</p>

## 工作方式

1. 添加一个或多个工作区。
2. 创建 session，并选择 Claude Code 或 Codex。
3. 如果仓库支持，Code Bar 会为该 session 自动创建独立 git worktree。
4. 启动 runner，在不离开应用的情况下查看终端输出、文件与 diff。

## 快速开始

### 第一步：下载安装

- [Windows x64 MSI](https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-windows-x64.msi)
- [macOS Apple Silicon DMG](https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-macos-apple-silicon.dmg)
- [macOS Intel DMG](https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-macos-intel.dmg)

### 第二步：安装 Claude Code 或 Codex

Code Bar 当前只支持这两个 runner：

- **Claude Code**（`@anthropic-ai/claude-code`）
- **OpenAI Codex**（`@openai/codex`）

如果本机缺少对应 CLI，Code Bar 可以直接打开一键安装终端。

### 第三步：添加工作区并启动 session

打开你的仓库，创建一个 session，让 Code Bar 为这个任务保持独立 worktree。

## 功能特性

### 并行会话工作流

- 创建和管理多个 AI 编码会话
- 跟踪会话状态：`idle` / `running` / `waiting` / `suspended` / `done` / `error`
- 跨重启持久化和恢复会话
- 在可用时通过已绑定的 Claude Code / Codex provider session ID 恢复会话

### Git worktree 隔离

- 在 git 仓库中为每个 session 自动创建专属 worktree
- 让并行 AI 改动彼此隔离，避免分支冲突
- 跟踪每个 session 的 branch、base branch 和 worktree 路径
- 删除 session 时自动清理 worktree

### 应用内终端与运行控制

- 每个 session 都有完整的 PTY 终端界面
- 在启动前可在 Claude Code 与 Codex 间切换 runner
- 当 session 完成或进入下一步等待时发送原生通知
- 为 Claude Code 和 Codex 提供 hooks 设置与集成开关

### Explorer、编辑器与 SCM

- 文件树始终以当前 session worktree 为根目录
- 内置代码编辑器，可直接保存 session 文件
- diff 查看器支持按文件和按 hunk 审阅
- SCM 侧边栏包含 staged、unstaged、untracked、conflict 以及 committed-in-session 分组
- 可在应用内完成 stage、unstage、discard、commit 和冲突解决

### 可定制的工作台界面

- 主题：light、dark、glass、system
- 语言切换：system、English、简体中文、Arabic
- 可配置右侧 widgets：terminal 与 usage 面板
- 支持编辑器分组和 widgets 拖拽布局

### Usage widgets

- 为当前选中 session 显示 runner usage 卡片
- Claude usage 可在存在 Anthropic API key 环境时读取 API header 快照
- Codex usage 可通过本地登录信息和远端 usage API 获取
- 在界面中展示 5 小时和 7 天窗口信息

## 支持的 Runner

| Runner | 说明 |
| --- | --- |
| **Claude Code** | Anthropic 官方 Claude Code CLI（`@anthropic-ai/claude-code`） |
| **OpenAI Codex** | OpenAI Codex CLI（`@openai/codex`） |

## 支持平台

- **macOS**：标准应用激活、菜单栏集成、原生通知，以及基于 Unix socket 的 hooks 流程
- **Windows**：托盘式行为、Codex 集成的 PowerShell / notify 兼容，以及 `.cmd` / `.bat` PTY 处理

## 从源码构建

### 环境要求

- Node.js 18+
- pnpm
- Rust
- 系统依赖：
  - **macOS**：Xcode Command Line Tools
  - **Windows**：Microsoft C++ Build Tools 和 WebView2（见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)）

### 安装

```bash
git clone https://github.com/For-Tr/code-bar.git
cd code-bar
pnpm install
```

### 开发

```bash
pnpm tauri dev
```

如果只跑前端开发服务器：

```bash
pnpm dev
```

### 生产构建

```bash
pnpm build
pnpm tauri build
```

<details>
<summary>开发说明</summary>

当多个 worktree 同时运行 `pnpm tauri dev` 时，Code Bar 会自动选择空闲的 Vite/HMR 端口，并同步更新 Tauri 的 `devUrl`。

</details>

## 贡献

欢迎提交 Issue 和 Pull Request。

1. Fork 本仓库
2. 创建你的功能分支（`git checkout -b feature/amazing-feature`）
3. 提交改动（`git commit -m 'Add amazing feature'`）
4. 推送分支（`git push origin feature/amazing-feature`）
5. 发起 Pull Request

## 许可证

本项目使用 [Apache License 2.0](LICENSE)。

## 作者

[@For-Tr](https://github.com/For-Tr)
