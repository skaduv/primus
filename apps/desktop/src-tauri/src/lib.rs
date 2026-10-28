//! 乾元（Primus）薄壳。目标代码量约 4000 行 Rust 以内（第 5.1 节）。
//!
//! 启动顺序：提权修复模式（`--repair-data-dir`）→ 准备数据目录（第 4 章，不可写时弹修复引导）→ 单实例 → 主窗口。
//! 各模块随开发计划逐步实现。

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
    // 修复引导以管理员身份拉起的子进程：只修复 data 权限，不打开窗口
    if paths::has_repair_arg(std::env::args_os().skip(1)) {
        std::process::exit(paths::run_repair_mode());
    }

    // 数据目录必须在任何其他模块之前就绪；不可写时只引导修复，绝不回退到 AppData（约束 C2）
    let Some(data_paths) = paths::prepare_or_guide() else {
        std::process::exit(1);
    };

    tauri::Builder::default()
        // 单实例必须最先注册：第二个实例启动时把已有主窗口带到前台（第 2.2 节）
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(data_paths)
        .run(tauri::generate_context!())
        .expect("failed to run Primus");
}
