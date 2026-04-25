use std::fs;
use std::path::{Path, PathBuf};

pub struct InstanceGuard {
    lock_path: PathBuf,
}

impl InstanceGuard {
    pub fn acquire(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|error| error.to_string())?;
        let lock_path = root.join("codebard.lock");
        match fs::OpenOptions::new().create_new(true).write(true).open(&lock_path) {
            Ok(mut file) => {
                use std::io::Write;
                writeln!(file, "{}", std::process::id()).map_err(|error| error.to_string())?;
                Ok(Self { lock_path })
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                Err("codebard is already running".to_string())
            }
            Err(error) => Err(error.to_string()),
        }
    }
}

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.lock_path);
    }
}
