use std::process::Command;

#[test]
fn prints_usage_without_args() {
    let output = Command::new(env!("CARGO_BIN_EXE_codebar"))
        .output()
        .expect("failed to run codebar");
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("usage:"));
}
