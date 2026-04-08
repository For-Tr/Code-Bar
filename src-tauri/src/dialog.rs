#[tauri::command]
pub fn pick_folder_cross_platform() -> String {
    #[cfg(target_os = "macos")]
    {
        let script = r#"
            set folderPath to POSIX path of (choose folder with prompt "Select workspace folder")
            return folderPath
        "#;
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output();
        return match output {
            Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
                .trim()
                .trim_end_matches('/')
                .to_string(),
            _ => String::new(),
        };
    }

    #[cfg(windows)]
    {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Write($dialog.SelectedPath)
}
"#;
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-STA", "-Command", script])
            .output();
        return match output {
            Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
                .trim()
                .trim_end_matches(['\\', '/'])
                .to_string(),
            _ => String::new(),
        };
    }

    #[cfg(all(not(target_os = "macos"), not(windows)))]
    {
        String::new()
    }
}
