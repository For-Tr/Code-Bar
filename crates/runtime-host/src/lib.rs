mod cwd;
mod env;
mod hooks;
mod pty_host;
mod supervisor;

pub use pty_host::PortablePtyRuntimeHost;

#[cfg(test)]
mod tests {
    use super::*;
    use daemon_core::domain::{DomainResult, EventEnvelope};
    use daemon_core::ports::{
        Clock, EventFilter, EventRepository, IdGenerator, LaunchSpec, RuntimeHost,
    };
    use std::sync::Arc;

    #[derive(Default)]
    struct TestIds;

    impl IdGenerator for TestIds {
        fn next_task_id(&self) -> String {
            "task-1".to_string()
        }

        fn next_session_id(&self) -> String {
            "session-1".to_string()
        }

        fn next_worktree_id(&self) -> String {
            "worktree-1".to_string()
        }

        fn next_run_attempt_id(&self) -> String {
            "run-1".to_string()
        }

        fn next_plan_id(&self) -> String {
            "plan-1".to_string()
        }

        fn next_plan_step_id(&self) -> String {
            "step-1".to_string()
        }

        fn next_skill_profile_id(&self) -> String {
            "skill-1".to_string()
        }

        fn next_approval_request_id(&self) -> String {
            "approval-1".to_string()
        }

        fn next_event_id(&self) -> String {
            "event-1".to_string()
        }
    }

    #[derive(Default)]
    struct TestClock;

    impl Clock for TestClock {
        fn now(&self) -> String {
            "1".to_string()
        }
    }

    #[derive(Default)]
    struct TestEvents;

    impl EventRepository for TestEvents {
        fn publish_event(&self, _event: EventEnvelope) -> DomainResult<()> {
            Ok(())
        }

        fn list_events(&self, _filter: &EventFilter) -> DomainResult<Vec<EventEnvelope>> {
            Ok(Vec::new())
        }
    }

    #[test]
    fn launch_and_stop_simulated_runtime() {
        let runtime = PortablePtyRuntimeHost::new(
            Arc::new(TestIds),
            Arc::new(TestClock),
            Arc::new(TestEvents),
        );

        let handle = runtime
            .launch(LaunchSpec {
                session_id: "session-1".to_string(),
                provider: codebar_contracts::domain::ProviderKind::Claude,
                launcher_type: codebar_contracts::domain::LauncherType::Pty,
                command: "nonexistent-command-that-will-not-run".to_string(),
                args: Vec::new(),
                cwd: "/tmp".to_string(),
                env: Default::default(),
                bootstrap_prompt: None,
                user_prompt: None,
                mcp_bridge_command: None,
                mcp_bridge_args: None,
                provider_session_id: None,
            })
            .unwrap();

        assert_eq!(handle.handle_id, "session-1");
        assert!(runtime.is_handle_alive("session-1"));
        runtime.stop("session-1", None).unwrap();
    }
}
