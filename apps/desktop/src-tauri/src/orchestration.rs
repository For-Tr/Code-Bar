use std::sync::{Arc, Mutex};

use task_orchestrator::{Engine, OrchestrationState};

pub struct OrchestrationRuntime {
    #[allow(dead_code)]
    engine: Engine,
    #[allow(dead_code)]
    state: Arc<Mutex<OrchestrationState>>,
}

impl Default for OrchestrationRuntime {
    fn default() -> Self {
        Self {
            engine: Engine::default(),
            state: Arc::new(Mutex::new(OrchestrationState::default())),
        }
    }
}
