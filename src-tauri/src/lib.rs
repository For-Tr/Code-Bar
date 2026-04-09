// ── 模块声明 ──────────────────────────────────────────────────────
mod cli_detect;
mod git;
mod harness;
mod hooks;
mod keystore;
mod notification;
mod pty;
mod runner;
mod session_lifecycle;
mod state;
mod util;
mod window;

use state::{
    PopupVisible, PreExpandPos, ProcessMap, PtyKillerMap, PtyMasterMap, PtySessionMetaMap,
    PtyWriterMap, RestoringLock,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

// ── macOS PATH 修复 ───────────────────────────────────────────────

/// GUI .app 启动时 PATH 极度精简，补充 Homebrew 等常见路径
#[cfg(target_os = "macos")]
fn fix_path_env() {
    use std::env;
    let current = env::var("PATH").unwrap_or_default();
    let extra = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"];
    let mut parts: Vec<&str> = current.split(':').collect();
    for dir in extra.iter().rev() {
        if !parts.contains(dir) {
            parts.insert(0, dir);
        }
    }
    env::set_var("PATH", parts.join(":"));
}

// ── 应用入口 ──────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    fix_path_env();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_liquid_glass::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ProcessMap::default())
        .manage(PtyWriterMap::default())
        .manage(PtyKillerMap::default())
        .manage(PtyMasterMap::default())
        .manage(PtySessionMetaMap::default())
        .manage(PopupVisible::new(false))
        .manage(PreExpandPos::new())
        .manage(RestoringLock::new())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // 启动 CLI hook 接收器（Unix Socket / Windows Loopback TCP）
            hooks::start_hook_socket_servers(app.handle().clone());

            // 自动配置 Claude / Codex hooks（幂等）
            if let Err(e) = hooks::setup_all_hooks() {
                eprintln!("[hooks] 自动配置失败（可忽略，CLI 仍可运行）: {e}");
            } else {
                eprintln!("[hooks] Claude / Codex hooks 已就绪");
            }

            // 隐藏默认主窗口
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.hide();
            }

            // 预创建 popup 窗口（hidden），让 WebView 在后台完成加载
            // 读取记忆的尺寸（没有则用默认值）
            let (popup_w, popup_h) = window::load_bounds(app.handle())
                .map(|b| (b.width, b.height))
                .unwrap_or((376.0, 600.0));
            let win = WebviewWindowBuilder::new(
                app.handle(),
                "popup",
                WebviewUrl::App("index.html".into()),
            )
            .title("")
            .inner_size(popup_w, popup_h)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .shadow(false)
            .resizable(true)
            .skip_taskbar(true)
            .visible(false)
            .build()
            .expect("Failed to pre-create popup window");

            #[cfg(target_os = "macos")]
            window::setup_popup_window(&win);

            window::position_popup(app.handle(), &win);

            // 系统托盘
            let quit_item = MenuItem::with_id(app, "quit", "退出 Code Bar", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&quit_item])?;

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .tooltip("Code Bar")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .build(app)?;

            let app_handle = app.handle().clone();
            tray.on_tray_icon_event(move |_tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    window::toggle_popup(&app_handle);
                }
            });

            let app_handle2 = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                if event.id().as_ref() == "quit" {
                    app_handle2.exit(0);
                }
            });

            // 后台预热 CLI 路径缓存（消除冷启动延迟）
            std::thread::spawn(|| {
                for cli in &["node", "claude", "codex"] {
                    let resolved = cli_detect::resolve_command_path(cli);
                    eprintln!("[warmup] {cli} -> {resolved}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 窗口控制
            window::close_popup,
            window::focus_popup,
            window::resize_popup,
            window::resize_popup_full,
            window::pick_folder,
            window::save_popup_bounds,
            window::load_popup_bounds,
            window::restore_popup_bounds,
            // API Key 安全存储
            keystore::save_api_key,
            keystore::load_api_key,
            // Runner（子进程模式）
            runner::start_runner,
            runner::stop_runner,
            runner::start_claude_session,
            runner::stop_claude_session,
            // NativeHarness 工具
            harness::harness_read_file,
            harness::harness_write_file,
            harness::harness_list_dir,
            harness::harness_run_command,
            harness::harness_git_diff,
            harness::harness_confirm,
            // CLI 检测
            cli_detect::check_cli,
            cli_detect::debug_env,
            cli_detect::detect_cli_config,
            // Git diff
            git::diff::get_git_diff,
            git::diff::get_git_diff_branch,
            // Git 分支管理
            git::branch::git_current_branch,
            git::branch::git_branch_create,
            git::branch::git_branch_switch,
            git::branch::git_branch_delete,
            git::branch::git_branch_merge,
            git::branch::git_repo_info,
            // Git Worktree 管理
            git::worktree::git_worktree_create,
            git::worktree::git_worktree_remove,
            git::worktree::git_worktree_list,
            git::worktree::git_worktree_merge,
            git::worktree::setup_session_worktree,
            git::worktree::teardown_session_worktree,
            git::worktree::prune_orphan_worktrees,
            // PTY 终端
            pty::start_pty_session,
            pty::write_pty,
            pty::resize_pty,
            pty::stop_pty_session,
            pty::send_pty_query,
            // 通知 & Hooks
            hooks::send_notification,
            hooks::setup_all_hooks,
            hooks::setup_claude_hooks,
            hooks::setup_codex_hooks,
            hooks::trust_workspace,
            // 支持点击回调的原生通知（macOS 常驻等待 + click callback）
            notification::send_notification_with_callback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
