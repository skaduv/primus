//! 平台差异集中在此（Windows / macOS / Linux）。第 20 章。

/// 一次性设置窗口外框位置与尺寸（物理像素）。
/// Windows 上用一次 `SetWindowPos` 原子更新：侧栏向左伸缩时窗口左边缘和宽度同时变，右边缘不跳。
#[cfg(windows)]
pub fn set_window_bounds(
    window: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> tauri::Result<()> {
    use std::ffi::c_void;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn SetWindowPos(
            hwnd: *mut c_void,
            insert_after: *mut c_void,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;

    let hwnd = window.hwnd()?;
    let cx = i32::try_from(width).unwrap_or(i32::MAX);
    let cy = i32::try_from(height).unwrap_or(i32::MAX);
    // SAFETY: hwnd 是 Tauri 持有且仍存活的主窗口句柄；SetWindowPos 不保留任何指针。
    let ok = unsafe {
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            x,
            y,
            cx,
            cy,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

/// 其他平台没有原子接口，分两步设置。
#[cfg(not(windows))]
pub fn set_window_bounds(
    window: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> tauri::Result<()> {
    window.set_position(tauri::PhysicalPosition::new(x, y))?;
    window.set_size(tauri::PhysicalSize::new(width, height))
}
