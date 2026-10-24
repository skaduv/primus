//! 乾元（Primus）薄壳。目标代码量约 4000 行 Rust 以内（第 5.1 节）。
//!
//! P0 第 1 周：空壳，只打开主窗口并保证单实例。各模块随开发计划逐步实现。

mod commands;
mod core_config;
mod fs_watch;
mod git;
mod job;
mod paths;
mod platform;
mod rpc_bridge;
mod session_index;
mod shell_detect;
mod supervisor;
mod tray;
mod updater;
mod vault;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // 单实例必须最先注册：第二个实例启动时把已有主窗口带到前台（第 2.2 节）
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .run(tauri::generate_context!())
        .expect("failed to run Primus");
}
