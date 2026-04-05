use std::fs;
use tauri::Manager;

/// 将 API Key 写入应用数据目录（简单 XOR 混淆）
#[tauri::command]
pub async fn save_api_key(
    app: tauri::AppHandle,
    provider: String,
    key: String,
) -> Result<(), String> {
    let key_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&key_dir).map_err(|e| e.to_string())?;

    // 简单 XOR 混淆（生产环境建议接入 macOS Keychain）
    let obfuscated: Vec<u8> = key
        .bytes()
        .enumerate()
        .map(|(i, b)| b ^ (i as u8 ^ 0xA5))
        .collect();
    let hex = obfuscated
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();

    let key_file = key_dir.join(format!(".key_{provider}"));
    fs::write(key_file, hex).map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取已保存的 API Key
#[tauri::command]
pub async fn load_api_key(
    app: tauri::AppHandle,
    provider: String,
) -> Result<String, String> {
    let key_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let key_file = key_dir.join(format!(".key_{provider}"));

    if !key_file.exists() {
        return Ok(String::new());
    }

    let hex = fs::read_to_string(key_file).map_err(|e| e.to_string())?;
    let bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .filter_map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect();
    let key: String = bytes
        .into_iter()
        .enumerate()
        .map(|(i, b)| (b ^ (i as u8 ^ 0xA5)) as char)
        .collect();
    Ok(key)
}
