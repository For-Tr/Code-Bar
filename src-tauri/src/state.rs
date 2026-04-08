use std::{
    collections::HashMap,
    io::Write,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

// ── 子进程注册表 ───────────────────────────────────────────────
pub type ProcessMap = Arc<Mutex<HashMap<String, std::process::Child>>>;

// ── PTY 注册表 ────────────────────────────────────────────────
/// session_id → PTY master writer
pub type PtyWriterMap = Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>;
/// session_id → PTY child 进程（用于 kill/wait）
pub type PtyKillerMap = Arc<Mutex<HashMap<String, Box<dyn portable_pty::Child + Send>>>>;
/// session_id → MasterPty（用于 resize）
pub type PtyMasterMap = Arc<Mutex<HashMap<String, Box<dyn portable_pty::MasterPty + Send>>>>;

#[derive(Debug, Clone, Default)]
pub struct PtySessionMeta {
    pub runner_type: String,
    pub workdir: String,
}

/// session_id → PTY 会话元信息（用于 hooks 事件精确路由）
pub type PtySessionMetaMap = Arc<Mutex<HashMap<String, PtySessionMeta>>>;

// ── 展开前小窗口位置快照（内存缓存，比磁盘快）─────────────────────
/// 展开终端面板时，把小窗口的精确位置存在这里。
/// 收起时优先从这里还原，避免磁盘数据过期导致位置漂移。
/// 取出后立即清空（一次性使用）。
#[derive(Debug, Clone, Copy)]
pub struct Bounds4 { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

pub struct PreExpandPos(Mutex<Option<Bounds4>>);

impl PreExpandPos {
    pub fn new() -> Self { Self(Mutex::new(None)) }

    pub fn set(&self, b: Bounds4) {
        *self.0.lock().unwrap() = Some(b);
    }

    /// 取出并清空（consume-once）
    pub fn take(&self) -> Option<Bounds4> {
        self.0.lock().unwrap().take()
    }
}

// ── 收起保护锁：阻止动画期间的 onResized 误写盘 ──────────────────
/// restore_popup_bounds 调用时记录时间戳，
/// save_popup_bounds 在保护期（600ms）内直接返回，不写盘。
pub struct RestoringLock(Mutex<Option<Instant>>);

impl RestoringLock {
    pub fn new() -> Self { Self(Mutex::new(None)) }

    /// 开始保护期（600ms，覆盖 0.10s 收起动画 + 500ms 前端防抖）
    pub fn arm(&self) {
        *self.0.lock().unwrap() = Some(Instant::now());
    }

    /// 是否在保护期内
    pub fn is_locked(&self) -> bool {
        self.0.lock().unwrap()
            .map(|t| t.elapsed() < Duration::from_millis(600))
            .unwrap_or(false)
    }
}

// ── Popup 可见状态 ─────────────────────────────────────────────
pub struct PopupVisible(Mutex<bool>);

impl PopupVisible {
    pub fn new(v: bool) -> Self {
        Self(Mutex::new(v))
    }

    pub fn get(&self) -> bool {
        *self.0.lock().unwrap()
    }

    pub fn set(&self, v: bool) {
        *self.0.lock().unwrap() = v;
    }
}
