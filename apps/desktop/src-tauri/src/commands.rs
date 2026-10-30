//! Tauri 命令入口（附录 B），只做参数校验与转发。

use tauri::State;
use tauri::ipc::Channel;

use crate::paths::DataPaths;
use crate::rpc_bridge::{BridgeError, CoreBatch};
use crate::sessions::{AppSessions, SessionError};
use crate::supervisor::Supervisor;

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

/// `session_open` 的返回值。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionHandle {
    session_key: String,
}

/// 打开会话：拉起 Core，事件批次经 `on_event` 推送（第 7.1、7.3 节）。工作区为空时在默认目录对话。
#[tauri::command(async)]
pub(crate) fn session_open(
    sessions: State<'_, AppSessions>,
    supervisor: State<'_, Supervisor>,
    paths: State<'_, DataPaths>,
    workspace: String,
    session_path: Option<String>,
    on_event: Channel<CoreBatch>,
) -> Result<SessionHandle, String> {
    sessions
        .open(
            &supervisor,
            &paths,
            &workspace,
            session_path.as_deref(),
            on_event,
        )
        .map(|session_key| SessionHandle { session_key })
        .map_err(|e| e.to_string())
}

/// 关闭会话并结束其 Core。
#[tauri::command(async)]
pub(crate) fn session_close(
    sessions: State<'_, AppSessions>,
    supervisor: State<'_, Supervisor>,
    session_key: String,
) -> Result<(), String> {
    sessions.close(&supervisor, &session_key);
    Ok(())
}

/// 会话命令的错误：`code` 供前端区分需要特别处理的情况（`coreNotRunning`：内核未运行，需重启内核），
/// 其余为 `null`；`message` 是界面文案。
#[derive(Debug, serde::Serialize)]
pub(crate) struct CoreCommandError {
    code: Option<&'static str>,
    message: String,
}

impl From<SessionError> for CoreCommandError {
    fn from(e: SessionError) -> Self {
        let code = match e {
            SessionError::NotRunning(_) | SessionError::Bridge(BridgeError::Closed) => {
                Some("coreNotRunning")
            }
            _ => None,
        };
        Self {
            code,
            message: e.to_string(),
        }
    }
}

/// 把一条 RPC 记录原样写入 Core 的 stdin；响应经批次返回。
#[tauri::command]
pub(crate) fn core_send(
    sessions: State<'_, AppSessions>,
    supervisor: State<'_, Supervisor>,
    session_key: String,
    record: serde_json::Value,
) -> Result<(), CoreCommandError> {
    sessions
        .send(&supervisor, &session_key, &record)
        .map_err(Into::into)
}

/// 重启会话的 Core（同一会话文件恢复）；前端随后用 `get_messages` + `get_state` 重建状态。
#[tauri::command(async)]
pub(crate) fn core_restart(
    sessions: State<'_, AppSessions>,
    supervisor: State<'_, Supervisor>,
    session_key: String,
) -> Result<(), CoreCommandError> {
    sessions
        .restart(&supervisor, &session_key)
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_not_running_code_covers_closed_bridge() {
        for e in [
            SessionError::NotRunning("k".to_owned()),
            SessionError::Bridge(BridgeError::Closed),
        ] {
            assert_eq!(CoreCommandError::from(e).code, Some("coreNotRunning"));
        }
        assert_eq!(
            CoreCommandError::from(SessionError::NotFound("k".to_owned())).code,
            None
        );
    }
}
