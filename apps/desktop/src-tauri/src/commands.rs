//! Tauri 命令入口（附录 B），只做参数校验与转发。

/// 原子设置主窗口外框（物理像素），侧栏开关时窗口边缘跟随侧栏逐帧伸缩用。
#[tauri::command]
pub fn window_set_bounds(
    window: tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("window size must be positive".into());
    }
    crate::platform::set_window_bounds(&window, x, y, width, height).map_err(|e| e.to_string())
}
