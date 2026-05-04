use codebar_contracts::errors::{ErrorCode, ErrorEnvelope};
use daemon_core::domain::DomainResult;
use daemon_core::ports::{PreparedWorktree, WorktreeHost, WorktreeStrategy};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const WORKTREE_ROOT_DIR: &str = ".code-bar-worktrees";
const WORKTREE_ROOT_DIR_DEV: &str = ".code-bar-worktrees-dev";

pub struct GitWorktreeHost;

impl GitWorktreeHost {
    fn session_worktree_root_dir() -> &'static str {
        if cfg!(debug_assertions) {
            WORKTREE_ROOT_DIR_DEV
        } else {
            WORKTREE_ROOT_DIR
        }
    }

    fn session_branch_prefix() -> String {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        let token = format!("{:06x}", millis % 0x1000000);
        format!("ci/{token}")
    }

    fn session_branch_name(prefix: &str, session_id: &str) -> String {
        format!("{prefix}/session-{session_id}")
    }

    fn run_git(repo_root: &Path, args: &[&str]) -> Result<std::process::Output, ErrorEnvelope> {
        std::process::Command::new("git")
            .current_dir(repo_root)
            .args(args)
            .output()
            .map_err(|error| {
                ErrorEnvelope::new(ErrorCode::GitOperationFailed, error.to_string(), true)
            })
    }

    fn current_branch(repo_root: &Path) -> Result<Option<String>, ErrorEnvelope> {
        let output = Self::run_git(repo_root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        if !output.status.success() {
            return Ok(None);
        }
        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if branch.is_empty() || branch == "HEAD" {
            Ok(None)
        } else {
            Ok(Some(branch))
        }
    }

    fn force_remove_worktree(repo_root: &Path, worktree_path: &Path) {
        let _ = std::process::Command::new("git")
            .current_dir(repo_root)
            .args([
                "worktree",
                "remove",
                "--force",
                &worktree_path.to_string_lossy(),
            ])
            .output();
        if worktree_path.exists() {
            let _ = fs::remove_dir_all(worktree_path);
        }
        let _ = std::process::Command::new("git")
            .current_dir(repo_root)
            .args(["worktree", "prune"])
            .output();
    }
}

impl WorktreeHost for GitWorktreeHost {
    fn prepare(
        &self,
        workspace_root: &str,
        session_id: &str,
        strategy: WorktreeStrategy,
    ) -> DomainResult<Option<PreparedWorktree>> {
        if matches!(strategy, WorktreeStrategy::Reuse) {
            return Ok(None);
        }

        let repo_root = PathBuf::from(workspace_root);
        let base_branch = match Self::current_branch(&repo_root)? {
            Some(branch) => branch,
            None => return Ok(None),
        };

        let repo_parent = repo_root.parent().unwrap_or(repo_root.as_path());
        let worktree_path = repo_parent
            .join(Self::session_worktree_root_dir())
            .join(format!("session-{session_id}"));
        let branch_prefix = Self::session_branch_prefix();
        let branch_name = Self::session_branch_name(&branch_prefix, session_id);

        Self::force_remove_worktree(&repo_root, &worktree_path);
        let _ = std::process::Command::new("git")
            .current_dir(&repo_root)
            .args(["branch", "-D", &branch_name])
            .output();

        if let Some(parent) = worktree_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                ErrorEnvelope::new(ErrorCode::GitOperationFailed, error.to_string(), true)
            })?;
        }

        let output = Self::run_git(
            &repo_root,
            &[
                "worktree",
                "add",
                "-b",
                &branch_name,
                &worktree_path.to_string_lossy(),
                "HEAD",
            ],
        )?;
        if !output.status.success() {
            return Err(ErrorEnvelope::new(
                ErrorCode::GitOperationFailed,
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
                true,
            ));
        }

        Ok(Some(PreparedWorktree {
            path: worktree_path.to_string_lossy().to_string(),
            branch_name: Some(branch_name),
            base_branch: Some(base_branch),
        }))
    }

    fn cleanup(
        &self,
        workspace_root: &str,
        path: &str,
        branch_name: Option<&str>,
    ) -> DomainResult<()> {
        let repo_root = PathBuf::from(workspace_root);
        let worktree_path = PathBuf::from(path);
        Self::force_remove_worktree(&repo_root, &worktree_path);
        if let Some(branch_name) = branch_name.filter(|branch| !branch.trim().is_empty()) {
            let _ = std::process::Command::new("git")
                .current_dir(&repo_root)
                .args(["branch", "-D", branch_name])
                .output();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::GitWorktreeHost;
    use daemon_core::ports::{WorktreeHost, WorktreeStrategy};
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codebar-worktree-host-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["init", "-b", "main"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["config", "user.email", "codebar@example.com"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["config", "user.name", "CodeBar"])
            .output()
            .unwrap();
        fs::write(root.join("README.md"), "hello\n").unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["add", "README.md"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&root)
            .args(["commit", "-m", "init"])
            .output()
            .unwrap();
        root
    }

    #[test]
    fn prepare_creates_real_git_worktree() {
        let repo = temp_repo("prepare");
        let host = GitWorktreeHost;
        let prepared = host
            .prepare(
                repo.to_string_lossy().as_ref(),
                "123",
                WorktreeStrategy::NewManaged,
            )
            .unwrap()
            .unwrap();
        assert!(PathBuf::from(&prepared.path).exists());
        assert!(prepared
            .branch_name
            .as_deref()
            .unwrap()
            .contains("session-123"));
        assert_eq!(prepared.base_branch.as_deref(), Some("main"));
    }

    #[test]
    fn cleanup_removes_worktree_directory() {
        let repo = temp_repo("cleanup");
        let host = GitWorktreeHost;
        let prepared = host
            .prepare(
                repo.to_string_lossy().as_ref(),
                "321",
                WorktreeStrategy::NewManaged,
            )
            .unwrap()
            .unwrap();
        host.cleanup(
            repo.to_string_lossy().as_ref(),
            &prepared.path,
            prepared.branch_name.as_deref(),
        )
        .unwrap();
        assert!(!PathBuf::from(&prepared.path).exists());
    }
}
