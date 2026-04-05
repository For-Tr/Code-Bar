use std::{
    collections::HashMap,
    io::Write,
    sync::{Arc, Mutex},
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
