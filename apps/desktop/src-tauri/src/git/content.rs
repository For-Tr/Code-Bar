use tauri::Emitter;

use crate::{
    git::diff::{parse_diff_hunks, parse_diff_note},
    util::{background_command, expand_path},
};

fn build_diff_file(path: &str, diff_text: &str) -> serde_json::Value {
    let hunks = parse_diff_hunks(diff_text);
    let note = parse_diff_note(diff_text);
    let additions = diff_text.lines().filter(|line| line.starts_with('+') && !line.starts_with("+++"))
        .count() as u32;
    let deletions = diff_text.lines().filter(|line| line.starts_with('-') && !line.starts_with("---"))
        .count() as u32;
    let mut entry = serde_json::json!({
        "path": path,
        "type": if additions > 0 && deletions == 0 {
            "added"
        } else if additions == 0 && deletions > 0 {
            "deleted"
        } else {
            "modified"
        },
        "additions": additions,
        "deletions": deletions,
        "binary": false,
        "hunks": hunks,
    });
    if let Some(note) = note {
        entry["note"] = serde_json::Value::String(note);
    }
    entry
}

fn get_diff_text(workdir: &str, mode: &str, path: &str) -> Result<String, String> {
    let args = match mode {
        "staged" => vec!["diff", "--cached", "HEAD", "--", path],
        "unstaged" => vec!["diff", "HEAD", "--", path],
        _ => return Err(format!("unsupported diff mode: {mode}")),
    };

    let output = background_command("git")
        .current_dir(workdir)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub async fn get_git_diff_side(
    app: tauri::AppHandle,
    session_id: String,
    workdir: String,
    path: String,
    mode: String,
) -> Result<(), String> {
    let expanded = expand_path(&workdir);
    let diff_text = get_diff_text(&expanded, &mode, &path)?;
    let file = build_diff_file(&path, &diff_text);
    let _ = app.emit(
        "scm-diff-side-update",
        serde_json::json!({"session_id": session_id, "mode": mode, "file": file}),
    );
    Ok(())
}
