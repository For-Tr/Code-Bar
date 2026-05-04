mod approval_executor;
mod contract_enum_map;
mod contract_map;
mod event_bus;
mod provider_adapter;
mod rpc;
mod single_instance;
mod wiring;
mod worktree_host;

#[tokio::main]
async fn main() {
    if let Err(error) = wiring::run().await {
        eprintln!("codebard failed: {error}");
        std::process::exit(1);
    }
}
