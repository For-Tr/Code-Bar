use crate::approval_executor::GitApprovalExecutor;
use crate::event_bus::EventBus;
use crate::rpc::{serve, DaemonRpc};
use crate::provider_adapter::RealProviderAdapter;
use crate::runtime::PortablePtyRuntimeHost;
use crate::single_instance::InstanceGuard;
use crate::storage::FileStore;
use crate::worktree_host::GitWorktreeHost;
use daemon_core::ports::{Clock, IdGenerator};
use daemon_core::services::{
    ApprovalService, DiagnosticsService, EventService, HealthService, PlanService,
    RecoveryCoordinator, ServiceContext, SessionService, TaskService, WorktreeService,
};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub async fn run() -> Result<(), String> {
    let root = default_daemon_root();
    let _guard = InstanceGuard::acquire(&root)?;
    let daemon = build_daemon(root)?;
    daemon.recovery.recover().map_err(|error| error.message.clone())?;
    serve(daemon).await
}

pub fn build_daemon(root: PathBuf) -> Result<DaemonRpc, String> {
    let store = Arc::new(FileStore::new(root.clone())?);
    let events = Arc::new(EventBus::new(store.events_path())?);
    let ctx = ServiceContext {
        clock: Arc::new(SystemClock),
        ids: Arc::new(SequenceIds::default()),
        store: store.clone() as Arc<dyn daemon_core::ports::DaemonStore>,
        events: events.clone(),
        runtime: Arc::new(PortablePtyRuntimeHost::new(
            Arc::new(SequenceIds::default()),
            Arc::new(SystemClock),
            events.clone(),
        )),
        worktrees: Arc::new(GitWorktreeHost),
        provider_adapter: Arc::new(RealProviderAdapter),
    };

    Ok(DaemonRpc {
        root,
        _store: store,
        events,
        task_service: TaskService::new(ctx.clone()),
        session_service: SessionService::new(ctx.clone()),
        worktree_service: WorktreeService::new(ctx.clone()),
        plan_service: PlanService::new(ctx.clone()),
        approval_service: ApprovalService::new(ctx.clone(), Arc::new(GitApprovalExecutor)),
        event_service: EventService::new(ctx.clone()),
        diagnostics_service: DiagnosticsService::new(ctx.clone()),
        health_service: HealthService::new(ctx.clone()),
        recovery: RecoveryCoordinator::new(ctx),
    })
}

pub fn default_daemon_root() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".codebar").join("codebard")
}

struct SystemClock;
impl Clock for SystemClock {
    fn now(&self) -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default();
        format!("{seconds}")
    }
}

#[derive(Default)]
struct SequenceIds {
    counter: Mutex<u64>,
}
impl SequenceIds {
    fn next(&self, prefix: &str) -> String {
        let mut counter = self.counter.lock().unwrap();
        *counter += 1;
        format!("{prefix}-{}", *counter)
    }
}
impl IdGenerator for SequenceIds {
    fn next_task_id(&self) -> String { self.next("task") }
    fn next_session_id(&self) -> String {
        let mut counter = self.counter.lock().unwrap();
        *counter += 1;
        counter.to_string()
    }
    fn next_worktree_id(&self) -> String { self.next("worktree") }
    fn next_run_attempt_id(&self) -> String { self.next("run") }
    fn next_plan_id(&self) -> String { self.next("plan") }
    fn next_plan_step_id(&self) -> String { self.next("step") }
    fn next_skill_profile_id(&self) -> String { self.next("skill") }
    fn next_approval_request_id(&self) -> String { self.next("approval") }
    fn next_event_id(&self) -> String { self.next("event") }
}

