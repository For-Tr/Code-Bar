pub const UI_STATE_NAMESPACE_DEV: &str = "dev";
pub const WORKTREE_ROOT_DIR: &str = ".code-bar-worktrees";
pub const WORKTREE_ROOT_DIR_DEV: &str = ".code-bar-worktrees-dev";

pub fn ui_state_namespace_dir() -> Option<&'static str> {
    if cfg!(debug_assertions) {
        Some(UI_STATE_NAMESPACE_DEV)
    } else {
        None
    }
}

pub fn session_worktree_root_dir() -> &'static str {
    if cfg!(debug_assertions) {
        WORKTREE_ROOT_DIR_DEV
    } else {
        WORKTREE_ROOT_DIR
    }
}
