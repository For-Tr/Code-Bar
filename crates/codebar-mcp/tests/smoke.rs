use mcp_bridge::{all_tools, has_tool};

#[test]
fn exposes_fixed_tool_registry() {
    let tools = all_tools();
    assert_eq!(tools.len(), 8);
    assert!(has_tool("session.attach"));
    assert!(has_tool("skill.invoke"));
}
