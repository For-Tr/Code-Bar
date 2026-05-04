use mcp_bridge::{all_tools, RpcClient};

fn main() {
    let _client = RpcClient::new(default_socket_path());
    let _tools = all_tools();
}

fn default_socket_path() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    format!("{home}/.codebar/codebard/codebard.sock")
}
