use std::collections::HashSet;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct Supervisor {
    simulated_sessions: Arc<Mutex<HashSet<String>>>,
}

impl Supervisor {
    pub fn mark_simulated(&self, session_id: &str) {
        self.simulated_sessions
            .lock()
            .unwrap()
            .insert(session_id.to_string());
    }

    pub fn clear(&self, session_id: &str) {
        self.simulated_sessions.lock().unwrap().remove(session_id);
    }

    pub fn is_simulated(&self, session_id: &str) -> bool {
        self.simulated_sessions.lock().unwrap().contains(session_id)
    }

    pub fn simulated_sessions(&self) -> Arc<Mutex<HashSet<String>>> {
        self.simulated_sessions.clone()
    }
}
