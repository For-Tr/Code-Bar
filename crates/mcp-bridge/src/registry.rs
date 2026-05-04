#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct McpTool {
    pub name: &'static str,
    pub rpc_method: &'static str,
}

const TOOLS: [McpTool; 8] = [
    McpTool {
        name: "session.attach",
        rpc_method: "session.attach",
    },
    McpTool {
        name: "context.get_current",
        rpc_method: "context.get_current",
    },
    McpTool {
        name: "task.get_next_action",
        rpc_method: "task.get_next_action",
    },
    McpTool {
        name: "task.update_progress",
        rpc_method: "task.update_progress",
    },
    McpTool {
        name: "task.complete_step",
        rpc_method: "task.complete_step",
    },
    McpTool {
        name: "task.block_step",
        rpc_method: "task.block_step",
    },
    McpTool {
        name: "skill.list_active",
        rpc_method: "skill.list_active",
    },
    McpTool {
        name: "skill.invoke",
        rpc_method: "skill.invoke",
    },
];

pub fn all_tools() -> &'static [McpTool] {
    &TOOLS
}

pub fn has_tool(name: &str) -> bool {
    TOOLS.iter().any(|tool| tool.name == name)
}
