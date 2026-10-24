//! 乾元（Primus）薄壳。目标代码量约 4000 行 Rust 以内（第 5.1 节）。

mod supervisor;
mod rpc_bridge;
mod job;
mod paths;
mod core_config;
mod vault;
mod session_index;
mod fs_watch;
mod git;
mod shell_detect;
mod tray;
mod updater;
mod platform;
mod commands;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("failed to run Primus");
}
