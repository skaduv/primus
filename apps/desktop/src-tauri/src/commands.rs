//! Tauri 命令入口（附录 B），只做参数校验与转发。

use std::io;
use std::path::{Component, Path};
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{Manager, State};

use crate::account::{AuthError, AuthStatus};
use crate::app_settings::AppSettings;
use crate::core_config::{
    FetchInput, ModelConfigState, ModelsInfo, ProviderInput, ProviderView, ProvidersChanged,
};
use crate::fs_watch::{IndexChanged, IndexNotifier};
use crate::paths::DataPaths;
use crate::providers::ProviderModel;
use crate::rpc_bridge::{BatchSink, BridgeError, CoreBatch};
use crate::session_index::{SessionIndex, SessionPage, SessionSummary};
use crate::sessions::{AppSessions, SessionError, Sessions};
use crate::supervisor::Supervisor;
use crate::updater::{
    InstallTrigger, LaunchOutcome, UpdateChannel, UpdateError, UpdateStatus, Updater,
};
use crate::usage_stats::UsageStats;
use crate::workspaces::{TrustDetails, WorkspaceInfo, Workspaces};

/// `app_info` 的返回值（附录 B）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppInfo {
    app_version: String,
    core_version: String,
    data_dir: String,
    platform: &'static str,
}

/// 应用版本、Core 版本、数据目录与平台信息（附录 B `app_info`）。
#[tauri::command]
pub(crate) fn app_info(paths: State<'_, DataPaths>, supervisor: State<'_, Supervisor>) -> AppInfo {
    let core_version = supervisor
        .core_package_version()
        .unwrap_or_else(|| "unknown".into());
    AppInfo {
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        core_version,
        data_dir: paths.root().to_string_lossy().into_owned(),
        platform: std::env::consts::OS,
    }
}

/// 读取 App 设置（附录 B `settings_get`）。
#[tauri::command]
pub(crate) fn settings_get(
    settings: State<'_, AppSettings>,
) -> serde_json::Map<String, serde_json::Value> {
    settings.get_all()
}

/// 增量写入 App 设置（附录 B `settings_set`）。
#[tauri::command]
pub(crate) fn settings_set(
    settings: State<'_, AppSettings>,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    settings.patch(patch)
}

/// 汇总近 12 个月的本地会话模型调用与完成任务统计（附录 B `usage_stats`）。
#[tauri::command(async)]
pub(crate) fn usage_stats(paths: State<'_, DataPaths>) -> UsageStats {
    crate::usage_stats::collect(&paths.sessions_dir())
}

/// 外部链接只允许 http/https，长度有限且不含空白与控制字符（防止被当成命令行参数或本地路径执行）。
fn check_external_url(target: &str) -> Result<(), String> {
    let lower = target.to_ascii_lowercase();
    let scheme_ok = lower.starts_with("https://") || lower.starts_with("http://");
    let host_ok = target.split_once("://").is_some_and(|(_, rest)| {
        !rest.is_empty() && !rest.starts_with('/') && !rest.starts_with('\\')
    });
    if !scheme_ok || !host_ok {
        return Err("只能打开 http 或 https 链接".into());
    }
    if target.len() > 2048 || target.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("链接格式不正确".into());
    }
    Ok(())
}

/// 用系统默认浏览器打开外部链接（附录 B `open_external`；前端已让用户确认）。
#[tauri::command]
pub fn open_external(target: String) -> Result<(), String> {
    check_external_url(&target)?;
    crate::platform::open_url(&target).map_err(|e| e.to_string())
}

/// 用系统默认程序打开回复里引用的本机文件（附录 B `open_path`）。路径须是已存在的本机绝对路径；
/// 可执行与脚本类文件不直接运行，改为在文件夹中显示并返回 `revealed`（见 open_path.rs）。
#[tauri::command]
pub fn open_path(path: String) -> Result<crate::open_path::OpenOutcome, String> {
    use crate::open_path::{OpenOutcome, check_path};
    let checked = check_path(&path)?;
    if checked.risky {
        crate::platform::reveal_in_folder(&checked.path).map_err(|e| e.to_string())?;
        return Ok(OpenOutcome::Revealed);
    }
    crate::platform::shell_open(&checked.path).map_err(|e| e.to_string())?;
    Ok(OpenOutcome::Opened)
}

/// 在系统文件管理器中显示回复里引用的本机文件（附录 B `reveal_path`），校验同 `open_path`。
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let checked = crate::open_path::check_path(&path)?;
    crate::platform::reveal_in_folder(&checked.path).map_err(|e| e.to_string())
}

/// 右栏预览回复里引用或 Agent 写出的本机文件（附录 B `preview_file`）：校验同 `open_path`，只读，最多 1 MiB。
#[tauri::command(async)]
pub(crate) fn preview_file(path: String) -> Result<crate::preview::Preview, String> {
    let checked = crate::open_path::check_path(&path)?;
    crate::preview::read_preview(&checked.path)
}

/// 右栏按“打开后的样子”预览 Word / PowerPoint / Excel / PDF、音频视频与 GIF / ICO / AVIF 图片
/// （附录 B `preview_file_bytes`）：校验同 `open_path`，只读，只接受这些扩展名，文档与图片最多 30 MiB、
/// 音频视频最多 64 MiB；以原始字节返回（前端得到 ArrayBuffer，不走 JSON / base64）。
#[tauri::command(async)]
pub(crate) fn preview_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let checked = crate::open_path::check_path(&path)?;
    crate::preview::read_document(&checked.path).map(tauri::ipc::Response::new)
}

/// 右栏文件夹预览（附录 B `preview_dir`）：校验同 `open_path`，只读目录项元数据，列出直接子项
/// （文件夹在前、按名称排序，最多 2000 项），隐藏 / 系统项带 `hidden` 标记由前端决定是否显示。
#[tauri::command(async)]
pub(crate) fn preview_dir(path: String) -> Result<crate::preview::DirListing, String> {
    let checked = crate::open_path::check_path(&path)?;
    crate::preview::list_dir(&checked.path, crate::platform::is_hidden_entry)
}

/// 右栏可运行的网页预览（附录 B `preview_serve`）：校验同 `open_path`，登记文件所在文件夹，
/// 返回 `primus-preview` 协议下该文件的 URL（见 preview_protocol）
#[tauri::command(async)]
pub(crate) fn preview_serve(
    roots: tauri::State<'_, crate::preview_protocol::PreviewRoots>,
    path: String,
) -> Result<String, String> {
    let checked = crate::open_path::check_path(&path)?;
    roots.serve(&checked.path)
}

/// 原子设置主窗口外框（物理像素），侧栏开关时窗口边缘跟随侧栏逐帧伸缩用。
/// 宽度最多到窗口所在显示器工作区的右边缘，避免展开侧栏时把程序推出屏幕。
#[tauri::command(async)]
pub fn window_set_bounds(
    window: tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    minimum_width: Option<u32>,
) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("window size must be positive".into());
    }
    let bounds = crate::window_placement::Bounds {
        x,
        y,
        width,
        height,
    };
    let center_x = f64::from(x) + f64::from(width) / 2.0;
    let center_y = f64::from(y) + f64::from(height) / 2.0;
    let bounds = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.monitor_from_point(center_x, center_y).ok().flatten())
        .map_or(bounds, |monitor| {
            let area = monitor.work_area();
            crate::window_placement::clip_width_to_work_area(
                bounds,
                crate::window_placement::WorkArea {
                    x: area.position.x,
                    y: area.position.y,
                    width: area.size.width,
                    height: area.size.height,
                },
                minimum_width.unwrap_or(1),
            )
        });
    crate::platform::set_window_bounds(&window, bounds.x, bounds.y, bounds.width, bounds.height)
        .map_err(|e| e.to_string())
}

/// 打开（登记）工作区：必须是已存在目录的绝对路径，返回显示名与信任状态（第 15.1 节）。
#[tauri::command(async)]
pub(crate) fn workspace_open(
    workspaces: State<'_, Workspaces>,
    path: String,
) -> Result<WorkspaceInfo, String> {
    workspaces.open(&path).map_err(|e| e.to_string())
}

/// 最近工作区，最近打开的在前。
#[tauri::command(async)]
pub(crate) fn workspace_list(
    workspaces: State<'_, Workspaces>,
) -> Result<Vec<WorkspaceInfo>, String> {
    workspaces.list().map_err(|e| e.to_string())
}

/// 信任确认需要展示的项目内容：`AGENTS.md` 与 `.primus/` 下的扩展、技能、MCP 配置。
#[tauri::command(async)]
pub(crate) fn workspace_inspect(path: String) -> Result<TrustDetails, String> {
    crate::workspaces::inspect(&path).map_err(|e| e.to_string())
}

/// 记录信任确认的选择（第 17.2 节）：只在首次添加工作区时确认一次，之后的改动沿用信任。
#[tauri::command(async)]
pub(crate) fn workspace_trust(
    workspaces: State<'_, Workspaces>,
    path: String,
    trusted: bool,
) -> Result<(), String> {
    workspaces.trust(&path, trusted).map_err(|e| e.to_string())
}

/// 对话框返回的路径转成本地路径字符串；不是本地路径时报错（不静默丢弃）。
fn local_path(p: tauri_plugin_dialog::FilePath) -> Result<String, String> {
    p.into_path()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("所选项目不是本地路径：{e}"))
}

/// 系统文件夹对话框（tauri-plugin-dialog），以主窗口为父窗口；取消时返回 None。
/// 异步命令在线程池中执行，阻塞等待对话框不会卡住主线程。
/// 插件把打开失败与取消都报告为“无结果”，无法区分；所选路径不可用时返回错误。
#[tauri::command(async)]
pub(crate) fn dialog_pick_folder(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    window
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_folder()
        .map(local_path)
        .transpose()
}

/// 系统文件对话框（可多选）；只返回本地路径，文件不复制。取消时返回空列表，
/// 所选路径不可用时返回错误。
#[tauri::command(async)]
pub(crate) fn dialog_pick_files(window: tauri::WebviewWindow) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    window
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .map(local_path)
        .collect()
}

/// 把对话内生成的图片另存到用户选的位置（附录 B `image_save`，ADR 0018）：只接受数据目录
/// `users/<SID>/images` 内的图片，弹系统“另存为”对话框后复制。取消时返回 None，成功返回保存的路径。
#[tauri::command(async)]
pub(crate) fn image_save(
    window: tauri::WebviewWindow,
    paths: State<'_, DataPaths>,
    path: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let src = crate::images::check_generated(&paths.images_dir(), &path)?;
    let ext = crate::images::image_ext(&src).unwrap_or_else(|| "png".into());
    let Some(picked) = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(crate::images::default_file_name(&src))
        .add_filter("图片", &[ext.as_str()])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let dest = picked
        .into_path()
        .map_err(|e| format!("所选位置不是本地路径：{e}"))?;
    crate::images::copy_to(&src, &dest)?;
    Ok(Some(dest.to_string_lossy().into_owned()))
}

/// 联网设置（ADR 0020）：是否允许 AI 联网搜索与读取网页。文件不存在或无效时为默认（开启），读取失败时报错。
#[tauri::command]
pub(crate) fn web_settings_get(
    paths: State<'_, DataPaths>,
) -> Result<crate::web_settings::WebSettings, String> {
    crate::web_settings::WebSettings::load(&crate::web_settings::settings_file(&paths))
        .map_err(|e| format!("读取联网设置失败：{e}"))
}

/// 修改联网设置并保存；Core 的 primus-web 在下一轮对话开始前读取，不需要重启 Core。
#[tauri::command]
pub(crate) fn web_settings_set(
    paths: State<'_, DataPaths>,
    enabled: bool,
) -> Result<crate::web_settings::WebSettings, String> {
    let settings = crate::web_settings::WebSettings { enabled };
    settings
        .save(&crate::web_settings::settings_file(&paths))
        .map_err(|e| format!("保存联网设置失败：{e}"))?;
    Ok(settings)
}

/// 通知与提示音设置（ADR 0023）。文件不存在或无效时为默认值，读取失败时报错。
#[tauri::command]
pub(crate) fn notification_settings_get(
    paths: State<'_, DataPaths>,
) -> Result<crate::notifications::NotificationSettings, String> {
    crate::notifications::NotificationSettings::load(&crate::notifications::settings_file(&paths))
        .map_err(|e| format!("读取通知设置失败：{e}"))
}

/// 保存通知与提示音设置（整份）。
#[tauri::command]
pub(crate) fn notification_settings_set(
    paths: State<'_, DataPaths>,
    settings: crate::notifications::NotificationSettings,
) -> Result<crate::notifications::NotificationSettings, String> {
    settings
        .save(&crate::notifications::settings_file(&paths))
        .map_err(|e| format!("保存通知设置失败：{e}"))?;
    Ok(settings)
}

/// 显示一条系统通知（是否该提醒由前端判断）。点击通知时把主窗口拉到前台，并把 `tag` 交给
/// `notification_watch` 的订阅者；`attention` 为 true 且窗口不在前台时同时闪烁任务栏按钮。
#[tauri::command(async)]
pub(crate) fn notification_show(
    app: tauri::AppHandle,
    request: crate::notifications::NotificationRequest,
) -> Result<(), String> {
    let request = request.clamp();
    if request.attention
        && let Some(window) = app.get_webview_window("main")
        && !window.is_focused().unwrap_or(false)
    {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
    let tag = request.tag.clone();
    crate::platform::toast::show(&request.title, &request.body, &request.tag, move || {
        crate::tray::show_main_window(&app);
        if let Some(hub) = app.try_state::<Arc<crate::notifications::NotificationHub>>() {
            hub.activate(tag.clone());
        }
    })
}

/// 订阅通知点击：每次点击经 `on_event` 推送通知的 `tag`。再次调用替换旧的订阅。
#[tauri::command]
pub(crate) fn notification_watch(
    hub: State<'_, Arc<crate::notifications::NotificationHub>>,
    on_event: Channel<String>,
) {
    hub.set_listener(move |tag| {
        let _ = on_event.send(tag);
    });
}

/// `session_open` 的返回值。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionHandle {
    session_key: String,
    /// 新会话的会话 ID（与会话索引中的 `id` 对应，前端据此把列表项与打开中的标签对上）；恢复已有会话时为 None
    session_id: Option<String>,
}

/// 打开会话：拉起 Core，事件批次经 `on_event` 推送（第 7.1、7.3 节）。工作区为空时在默认目录对话。
#[tauri::command(async)]
pub(crate) fn session_open(
    sessions: State<'_, AppSessions>,
    supervisor: State<'_, Supervisor>,
    paths: State<'_, DataPaths>,
    workspaces: State<'_, Workspaces>,
    workspace: String,
    session_path: Option<String>,
    on_event: Channel<CoreBatch>,
) -> Result<SessionHandle, String> {
    // 信任状态由薄壳按 workspaces.json 判定，不取前端传入的值（第 17.2 节）；默认工作区不加载项目资源
    let approve = !workspace.trim().is_empty() && workspaces.approved(&workspace);
    sessions
        .open_with_trust(
            &supervisor,
            &paths,
            &workspace,
            session_path.as_deref(),
            approve,
            on_event,
        )
        .map(|session_key| SessionHandle {
            session_id: sessions.session_id(&session_key),
            session_key,
        })
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

impl CoreCommandError {
    fn new(code: Option<&'static str>, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
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
    workspaces: State<'_, Workspaces>,
    session_key: String,
) -> Result<(), CoreCommandError> {
    // 重启前重新判定信任：`.primus/` 变化或信任被撤销后不再以 --approve 启动（第 17.2 节）
    sessions
        .restart_checked(&supervisor, &session_key, |cwd| {
            workspaces.approved(&cwd.to_string_lossy())
        })
        .map_err(Into::into)
}

/// 会话列表与搜索的工作区过滤（ADR 0006）：None 为全部工作区；空串为未选工作区的默认目录；其余按路径键比较。
fn workspace_key(paths: &DataPaths, workspace: Option<&str>) -> Option<String> {
    let workspace = workspace?;
    Some(if workspace.trim().is_empty() {
        crate::platform::path_key(&crate::sessions::default_workspace_dir(paths).to_string_lossy())
    } else {
        crate::platform::path_key(workspace)
    })
}

/// 未选工作区时会话使用的默认工作目录（`users/<SID>/chat` 的完整路径），左栏据此区分“项目”与“最近”。
#[tauri::command]
pub(crate) fn session_default_workspace(paths: State<'_, DataPaths>) -> String {
    crate::sessions::default_workspace_dir(&paths)
        .to_string_lossy()
        .into_owned()
}

/// 会话列表（第 10.2 节）：最后活动时间倒序、每页 50 条、不含已归档；`cursor` 为上一页的 `nextCursor`。
#[tauri::command(async)]
pub(crate) fn session_list(
    index: State<'_, Arc<SessionIndex>>,
    paths: State<'_, DataPaths>,
    workspace: Option<String>,
    cursor: Option<String>,
) -> Result<SessionPage, String> {
    index
        .list(
            workspace_key(&paths, workspace.as_deref()).as_deref(),
            cursor.as_deref(),
        )
        .map_err(|e| e.to_string())
}

/// 搜索会话（含已归档，最多 50 条）：3 个字符以上匹配消息全文，更短只匹配会话名与首条消息。
#[tauri::command(async)]
pub(crate) fn session_search(
    index: State<'_, Arc<SessionIndex>>,
    paths: State<'_, DataPaths>,
    workspace: Option<String>,
    query: String,
) -> Result<Vec<SessionSummary>, String> {
    index
        .search(
            workspace_key(&paths, workspace.as_deref()).as_deref(),
            &query,
        )
        .map_err(|e| e.to_string())
}

/// 列出已归档的会话（按最后活动时间倒序，最多 200 条）。
#[tauri::command(async)]
pub(crate) fn session_list_archived(
    index: State<'_, Arc<SessionIndex>>,
    paths: State<'_, DataPaths>,
    workspace: Option<String>,
) -> Result<Vec<SessionSummary>, String> {
    index
        .list_archived(workspace_key(&paths, workspace.as_deref()).as_deref())
        .map_err(|e| e.to_string())
}

/// 订阅会话索引的变化：每次变化经 `on_event` 推送 `{ seq }`，前端据此重新拉取列表。再次调用替换旧的订阅。
#[tauri::command]
pub(crate) fn session_watch(
    notifier: State<'_, Arc<IndexNotifier>>,
    on_event: Channel<IndexChanged>,
) {
    notifier.set_listener(move |e| {
        let _ = on_event.send(e);
    });
    // 注册前发生的索引变化没有推给前端（前端注册与首次拉取并发）：注册后补发一次，让前端重新拉取
    notifier.notify();
}

/// 归档或取消归档（只改索引，会话文件不动）。
#[tauri::command(async)]
pub(crate) fn session_archive(
    index: State<'_, Arc<SessionIndex>>,
    notifier: State<'_, Arc<IndexNotifier>>,
    session_path: String,
    archived: bool,
) -> Result<(), String> {
    match index.set_archived(&session_path, archived) {
        Ok(true) => {
            notifier.notify();
            Ok(())
        }
        Ok(false) => Err(format!("会话不在索引中：{session_path}")),
        Err(e) => Err(e.to_string()),
    }
}

/// 删除会话：永久删除会话文件（不进回收站，不可恢复）并删除索引。会话打开中也可以删除：先结束它的 Core。
#[tauri::command(async)]
pub(crate) fn session_delete(
    sessions: State<'_, AppSessions>,
    supervisor: State<'_, Supervisor>,
    index: State<'_, Arc<SessionIndex>>,
    notifier: State<'_, Arc<IndexNotifier>>,
    session_path: String,
) -> Result<(), CoreCommandError> {
    delete_session(
        &sessions,
        &index,
        &notifier,
        &session_path,
        |key| {
            supervisor.stop(key);
        },
        remove_file_retrying,
    )?;
    notifier.notify();
    Ok(())
}

/// 永久删除文件。刚结束的 Core 进程可能还没完全释放文件句柄（Windows 上删除会得到共享冲突），短暂重试几次。
fn remove_file_retrying(path: &Path) -> io::Result<()> {
    let mut attempt = 0;
    loop {
        match std::fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
            // 5 = ERROR_ACCESS_DENIED（删除挂起等），32 = ERROR_SHARING_VIOLATION（句柄未带 FILE_SHARE_DELETE）
            Err(e)
                if attempt < 10
                    && (e.kind() == io::ErrorKind::PermissionDenied
                        || (cfg!(windows) && e.raw_os_error() == Some(32))) =>
            {
                attempt += 1;
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(e),
        }
    }
}

/// 删除会话的步骤（`stop`、`remove` 可替换，便于测试）：只接受会话目录下的 `.jsonl` 普通文件，
/// 拒绝相对路径、`..`、符号链接与目录外的文件。使用这个文件的打开中会话先关闭（`stop` 结束其 Core），
/// 关闭与删除之间登记“删除中”（`Sessions::delete_closing`），期间打开同一文件被拒绝。
fn delete_session<S: BatchSink + Clone>(
    sessions: &Sessions<S>,
    index: &SessionIndex,
    notifier: &IndexNotifier,
    session_path: &str,
    stop: impl FnMut(&str),
    remove: impl FnOnce(&Path) -> io::Result<()>,
) -> Result<(), CoreCommandError> {
    let invalid = || CoreCommandError::new(None, format!("不是会话文件：{session_path}"));
    let path = Path::new(session_path);
    if !path.is_absolute()
        || !path.extension().is_some_and(|e| e == "jsonl")
        || path.components().any(|c| matches!(c, Component::ParentDir))
    {
        return Err(invalid());
    }
    let meta =
        std::fs::symlink_metadata(path).map_err(|e| CoreCommandError::new(None, e.to_string()))?;
    if !meta.file_type().is_file() {
        return Err(invalid());
    }
    let inside = match (
        path.parent().map(std::fs::canonicalize),
        std::fs::canonicalize(index.sessions_dir()),
    ) {
        (Some(Ok(parent)), Ok(root)) => parent.starts_with(&root),
        _ => false,
    };
    if !inside {
        return Err(invalid());
    }
    // 会话 ID 先取索引中的，不在索引中（尚未扫描到）时读文件头：打开中的新会话只按会话 ID 登记
    let id = index
        .session_id(session_path)
        .map_err(|e| CoreCommandError::new(None, e.to_string()))?
        .or_else(|| crate::session_index::session_file_id(path));
    sessions
        .delete_closing(path, id.as_deref(), stop, || remove(path))
        .map_err(|e| CoreCommandError::new(None, e.to_string()))?
        .map_err(|e| CoreCommandError::new(None, e.to_string()))?;
    index
        .remove(session_path)
        .map_err(|e| CoreCommandError::new(None, e.to_string()))?;
    // 删除文件与删除索引之间，同一路径可能已出现新的会话文件并被监听器写入索引（刚被上面一并删掉）：
    // 按路径的当前文件状态重新同步，文件不在则保持删除，有新文件则重新入索引。文件已移走，同步失败不算删除失败；
    // 失败时请监听线程做一次全量扫描（失败按退避重试），保证新文件最终回到索引
    if let Err(e) = index.update_file(path) {
        eprintln!("会话删除后重新同步索引失败（{session_path}），改为全量扫描：{e}");
        if !notifier.request_rescan() {
            eprintln!("会话目录监听未建立，无法安排全量扫描");
        }
    }
    Ok(())
}

/// 账号状态（第 9.7 节）。账号服务接入前恒为未登录、不可登录。
#[tauri::command]
pub(crate) fn auth_status() -> AuthStatus {
    crate::account::status()
}

/// 系统浏览器登录（PKCE）。账号服务接入前返回 `notAvailable`。
#[tauri::command]
pub(crate) fn auth_login() -> Result<AuthStatus, AuthError> {
    crate::account::login()
}

/// 登出。账号服务接入前返回 `notAvailable`。
#[tauri::command]
pub(crate) fn auth_logout() -> Result<(), AuthError> {
    crate::account::logout()
}

/// 可用模型列表、默认值与配置状态（第 9.2、9.5 节）。
#[tauri::command]
pub(crate) fn models_get(models: State<'_, ModelConfigState>) -> ModelsInfo {
    models.info()
}

/// 重新读取 `providers.json` 并重写 Core 的 `models.json` 与默认模型（不联网获取模型列表）。
#[tauri::command(async)]
pub(crate) fn models_refresh(models: State<'_, ModelConfigState>) -> ModelsInfo {
    models.refresh()
}

/// 订阅模型配置变化：每次渠道保存 / 删除、刷新、改默认模型或启动时后台获取到内置渠道的模型后推送完整的 `ModelsInfo`。
/// 再次调用替换旧的订阅。
#[tauri::command]
pub(crate) fn models_watch(models: State<'_, ModelConfigState>, on_event: Channel<ModelsInfo>) {
    models.set_listener(move |info| {
        let _ = on_event.send(info);
    });
}

/// 全部模型渠道（含 `hasKey` 与密钥末 4 位 `keyHint`，不含密钥）。
#[tauri::command(async)]
pub(crate) fn providers_list(
    models: State<'_, ModelConfigState>,
) -> Result<Vec<ProviderView>, String> {
    models.providers_list()
}

/// 新建（`input.id` 缺省）或修改渠道；`input.apiKey` 缺省为保留已存的密钥。保存后重写 Core 配置；
/// 内置渠道恢复为空白种子配置时，同步密钥并在后台获取模型。
#[tauri::command(async)]
pub(crate) fn provider_save(
    app: tauri::AppHandle,
    models: State<'_, ModelConfigState>,
    input: ProviderInput,
) -> Result<ProvidersChanged, String> {
    let changed = models.provider_save(input)?;
    // 内置渠道改回种子配置后会立即重新隐藏，密钥已在保存时同步；模型为空时在后台获取，
    // 否则用户只能重启 App 才能拿到模型。
    if changed.fetch_builtin_models {
        crate::spawn_builtin_models_fetch(app);
    }
    Ok(changed)
}

/// 删除渠道及其密钥，重写 Core 配置。
#[tauri::command(async)]
pub(crate) fn provider_delete(
    models: State<'_, ModelConfigState>,
    id: String,
) -> Result<ProvidersChanged, String> {
    models.provider_delete(&id)
}

/// 从渠道的模型列表接口获取模型（不保存）：已保存的渠道给 `id`（可带未保存的修改），草稿给 `api` + `baseUrl` + `apiKey`。
/// 已保存的模型保留用户改过的参数，新模型用默认参数。
#[tauri::command]
pub(crate) async fn provider_fetch_models(
    models: State<'_, ModelConfigState>,
    input: FetchInput,
) -> Result<Vec<ProviderModel>, String> {
    let target = models.fetch_target(input)?;
    let fetched = crate::providers::fetch_models(target.api, &target.base_url, &target.key).await?;
    Ok(crate::providers::merge_models(&target.saved, &fetched))
}

/// 设置页改选默认模型（`provider/modelId`，只能选列表中的模型；新拉起的 Core 进程生效）。
#[tauri::command]
pub(crate) fn models_set_default(
    models: State<'_, ModelConfigState>,
    model: String,
) -> Result<ModelsInfo, String> {
    models.set_default(&model)
}

/// 自动更新状态：当前版本、是否可用、设置、进行中的阶段与已下载待装的版本（第 3.6 节、ADR 0007）。
#[tauri::command]
pub(crate) fn update_status(updater: State<'_, Arc<Updater>>) -> UpdateStatus {
    updater.status()
}

/// 订阅更新状态：注册后立即推送一次，之后每次变化（检查、下载进度、下载完成、设置修改）推送完整状态。
/// 再次调用替换旧的订阅。
#[tauri::command]
pub(crate) fn update_watch(updater: State<'_, Arc<Updater>>, on_event: Channel<UpdateStatus>) {
    updater.set_listener(move |status| {
        let _ = on_event.send(status);
    });
}

/// 立即检查更新（设置页“立即检查”）；有更高版本时下载、验签并存为待装包，返回检查后的状态。
/// `channel` 只用于本次检查（不保存），缺省用设置中的通道。
#[tauri::command]
pub(crate) async fn update_check(
    app: tauri::AppHandle,
    updater: State<'_, Arc<Updater>>,
    channel: Option<UpdateChannel>,
) -> Result<UpdateStatus, UpdateError> {
    let updater = updater.inner().clone();
    updater.check_and_download(&app, channel, true).await
}

/// 修改更新设置（自动更新开关、通道），保存到 `users/<SID>/app/update.json`；自动更新从关到开时立即在后台检查一次。
#[tauri::command]
pub(crate) fn update_settings_set(
    app: tauri::AppHandle,
    updater: State<'_, Arc<Updater>>,
    auto_update: Option<bool>,
    channel: Option<UpdateChannel>,
) -> Result<UpdateStatus, UpdateError> {
    if updater.set_settings(auto_update, channel)? && updater.available() {
        let updater = updater.inner().clone();
        tauri::async_runtime::spawn(async move {
            let _ = updater.check_and_download(&app, None, false).await;
        });
    }
    Ok(updater.status())
}

/// 立即重启并安装已下载的更新。有正在运行的 Agent 时返回 `busy`，前端确认后带 `force` 再调。
/// 忙碌检查与“安装中”标记在会话表的同一次加锁内完成，之后新的 prompt 与会话拉起被拒绝，直到安装取消或失败。
/// 安装包校验通过后交给更新服务（静默安装、装完重新打开），服务不可用时经 UAC 拉起安装器；服务接手或安装器已运行
/// 才结束全部 Core 并退出。用户取消 UAC 返回 `cancelled`、失败返回 `failed` / `invalid`：这些情况下 Core 都没有被停掉，
/// 会话照常可用，待装包（未被判为无效时）保留，下次启动或退出时再装。
#[tauri::command(async)]
pub(crate) fn update_install(
    app: tauri::AppHandle,
    updater: State<'_, Arc<Updater>>,
    sessions: State<'_, AppSessions>,
    supervisor: State<'_, Supervisor>,
    force: Option<bool>,
) -> Result<(), UpdateError> {
    let hold = sessions
        .hold_for_update(force.unwrap_or(false))
        .ok_or_else(|| UpdateError::new("busy", "有正在运行的 Agent，更新会停止它们"))?;
    let package = updater.prepare_install()?;
    updater.set_installing(true);
    match crate::updater::launch(&updater, package, InstallTrigger::RestartNow) {
        Ok(LaunchOutcome::Started) => {
            // 安装器会替换 resources 下的 node.exe 与 Core 文件：结束全部 Core（含工具子进程）后退出
            supervisor.shutdown();
            app.exit(0);
            std::mem::forget(hold);
            Ok(())
        }
        Ok(LaunchOutcome::Cancelled | LaunchOutcome::Deferred) => {
            drop(hold);
            updater.set_installing(false);
            Err(UpdateError::new(
                "cancelled",
                "已取消管理员授权。更新包已保留，下次启动 Primus 时会再次安装",
            ))
        }
        Err(e) => {
            drop(hold);
            updater.set_installing(false);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::check_external_url;

    #[test]
    fn attachment_image_rejects_remote_and_relative_paths() {
        for bad in [
            r"\\server\share\a.png",
            "//server/share/a.png",
            r"\\?\C:\a.png",
            "file:///C:/a.png",
            "a.png",
            "C:\\a\u{7}.png",
        ] {
            assert!(super::attachment_image(bad.into(), 512).is_err(), "{bad}");
        }
    }

    #[test]
    fn external_url_only_http_https() {
        assert!(check_external_url("https://example.com/a?b=1").is_ok());
        assert!(check_external_url("HTTP://example.com").is_ok());
        for bad in [
            "file:///C:/Windows/System32/cmd.exe",
            "C:\\Windows\\notepad.exe",
            "javascript:alert(1)",
            "https://",
            "https:///etc/passwd",
            "https://example.com/a b",
            "https://example.com/\n",
            "ms-settings:",
            "ms-settings:privacy-webcam",
            "ms-settings:privacy-microphone",
            "ms-settings:privacy-speech",
        ] {
            assert!(check_external_url(bad).is_err(), "{bad}");
        }
    }

    use super::*;

    mod delete {
        use super::*;
        use crate::rpc_bridge::BridgeConfig;
        use crate::supervisor::tests::TempDir;
        use std::cell::Cell;

        #[derive(Clone)]
        struct NoSink;
        impl BatchSink for NoSink {
            fn send(&self, _batch: CoreBatch) -> bool {
                true
            }
        }

        fn setup() -> (TempDir, std::path::PathBuf, SessionIndex, Sessions<NoSink>) {
            let tmp = TempDir::new();
            let dir = tmp.0.join("sessions");
            std::fs::create_dir(&dir).unwrap();
            let index = SessionIndex::open_in_memory(&dir).unwrap();
            (tmp, dir, index, Sessions::new(BridgeConfig::default()))
        }

        fn no_stop(_key: &str) {}

        fn write_session(dir: &Path, name: &str) -> String {
            let p = dir.join(name);
            std::fs::write(
                &p,
                "{\"type\":\"session\",\"id\":\"x\",\"timestamp\":\"2026-11-03T00:00:00.000Z\",\"cwd\":\"/w\"}\n",
            )
            .unwrap();
            p.to_str().unwrap().to_owned()
        }

        #[test]
        fn removes_file_and_index_entry() {
            let (_tmp, dir, index, sessions) = setup();
            let path = write_session(&dir, "a.jsonl");
            std::fs::write(
                &path,
                format!(
                    "{}{}\n",
                    std::fs::read_to_string(&path).unwrap(),
                    "{\"type\":\"message\",\"id\":\"m\",\"parentId\":null,\"timestamp\":\"2026-11-03T00:00:00.000Z\",\"message\":{\"role\":\"user\",\"content\":\"hi\",\"timestamp\":1}}"
                ),
            )
            .unwrap();
            index.sync_all().unwrap();
            let removed = Cell::new(false);
            delete_session(
                &sessions,
                &index,
                &IndexNotifier::default(),
                &path,
                no_stop,
                |p| {
                    removed.set(true);
                    std::fs::remove_file(p)
                },
            )
            .unwrap();
            assert!(removed.get());
            assert!(!Path::new(&path).exists());
            assert!(index.list(None, None).unwrap().items.is_empty());
        }

        #[test]
        fn file_recreated_at_same_path_is_reindexed_after_delete() {
            let (_tmp, dir, index, sessions) = setup();
            let path = write_session(&dir, "a.jsonl");
            index.sync_all().unwrap();
            index.set_archived(&path, true).unwrap();
            delete_session(&sessions, &index, &IndexNotifier::default(), &path, no_stop, |p| {
                std::fs::remove_file(p)?;
                // 删除后、删除索引前，同一路径出现新的会话文件，监听器已把它写入索引
                std::fs::write(
                    p,
                    "{\"type\":\"session\",\"id\":\"y\",\"timestamp\":\"2026-11-03T00:00:00.000Z\",\"cwd\":\"/w\"}\n",
                )?;
                index.update_file(p).map(|_| ()).map_err(io::Error::other)
            })
            .unwrap();
            let items = index.list(None, None).unwrap().items;
            assert_eq!(items.len(), 1, "同一路径的新会话文件应留在索引中");
            assert_eq!(items[0].id, "y");
            assert!(!items[0].archived, "新文件不继承旧文件的归档标记");
        }

        #[test]
        fn failed_resync_after_delete_requests_full_scan() {
            let (_tmp, dir, index, sessions) = setup();
            let path = write_session(&dir, "a.jsonl");
            index.sync_all().unwrap();
            let notifier = IndexNotifier::default();
            let (tx, rx) = std::sync::mpsc::channel();
            notifier.set_rescanner(tx);
            // 删除后的重新同步写不进索引（同一路径的新文件 `y`）
            index.execute_batch_for_test(
                "CREATE TEMP TRIGGER fail_y BEFORE INSERT ON sessions WHEN NEW.id = 'y'
                 BEGIN SELECT RAISE(ABORT, 'boom'); END;",
            );
            delete_session(&sessions, &index, &notifier, &path, no_stop, |p| {
                std::fs::remove_file(p)?;
                std::fs::write(
                    p,
                    "{\"type\":\"session\",\"id\":\"y\",\"timestamp\":\"2026-11-03T00:00:00.000Z\",\"cwd\":\"/w\"}\n",
                )
            })
            .unwrap();
            assert!(index.list(None, None).unwrap().items.is_empty());
            // 请求了一次全量扫描（由监听线程执行并按退避重试）
            let event = rx.try_recv().expect("应请求全量扫描").unwrap();
            assert!(event.need_rescan());
            index.execute_batch_for_test("DROP TRIGGER fail_y;");
            index.sync_all().unwrap();
            assert_eq!(index.list(None, None).unwrap().items[0].id, "y");
            // 重新同步成功时不请求
            let path_b = write_session(&dir, "b.jsonl");
            delete_session(&sessions, &index, &notifier, &path_b, no_stop, |p| {
                std::fs::remove_file(p)
            })
            .unwrap();
            assert!(rx.try_recv().is_err());
        }

        #[test]
        fn rejects_paths_outside_sessions_dir() {
            let (tmp, dir, index, sessions) = setup();
            let outside = write_session(&tmp.0, "outside.jsonl");
            let escaped = format!("{}/../outside.jsonl", dir.display());
            let txt = dir.join("a.txt");
            std::fs::write(&txt, "x").unwrap();
            let never = |_: &Path| -> io::Result<()> { panic!("不应删除文件") };
            for bad in [
                outside.as_str(),
                escaped.as_str(),
                "relative.jsonl",
                txt.to_str().unwrap(),
                dir.to_str().unwrap(),
            ] {
                assert!(
                    delete_session(
                        &sessions,
                        &index,
                        &IndexNotifier::default(),
                        bad,
                        no_stop,
                        never
                    )
                    .is_err(),
                    "{bad}"
                );
            }
            assert!(Path::new(&outside).exists());
        }

        #[cfg(unix)]
        #[test]
        fn rejects_symlinks() {
            let (tmp, dir, index, sessions) = setup();
            let target = write_session(&tmp.0, "target.jsonl");
            let link = dir.join("link.jsonl");
            std::os::unix::fs::symlink(&target, &link).unwrap();
            let never = |_: &Path| -> io::Result<()> { panic!("不应删除文件") };
            assert!(
                delete_session(
                    &sessions,
                    &index,
                    &IndexNotifier::default(),
                    link.to_str().unwrap(),
                    no_stop,
                    never
                )
                .is_err()
            );
        }

        #[test]
        fn open_session_is_closed_then_deleted() {
            // 恢复的会话按文件登记、新会话只按会话 ID（文件头的 `x`）登记：两种都先结束 Core 再删除
            for (file, id) in [(true, None), (false, Some("x"))] {
                let (_tmp, dir, index, sessions) = setup();
                // Core 为新会话建的文件名为 `<时间戳>_<会话 ID>.jsonl`
                let path = write_session(&dir, "2026-11-03T00-00-00-000Z_x.jsonl");
                index.sync_all().unwrap();
                sessions.insert_idle_for_test("s1", file.then_some(path.as_str()), id, NoSink);
                sessions.insert_idle_for_test("other", None, Some("unrelated"), NoSink);
                let stopped = std::cell::RefCell::new(Vec::new());
                delete_session(
                    &sessions,
                    &index,
                    &IndexNotifier::default(),
                    &path,
                    |k| stopped.borrow_mut().push(k.to_owned()),
                    |p| {
                        // 删除文件时会话已移出会话表
                        assert!(!sessions.is_using(p, Some("x")));
                        std::fs::remove_file(p)
                    },
                )
                .unwrap();
                assert_eq!(*stopped.borrow(), vec!["s1".to_owned()]);
                assert!(!Path::new(&path).exists());
                assert!(index.list(None, None).unwrap().items.is_empty());
                // 无关的会话不受影响
                assert!(sessions.session_id("other").is_some());
            }
        }

        #[test]
        fn deleting_a_copy_keeps_the_new_session_open() {
            // 副本保留原文件头的会话 ID `x`，但不是 Core 为新会话 `x` 建的文件：删除副本不关闭那个新会话
            let (_tmp, dir, index, sessions) = setup();
            let copy = write_session(&dir, "copy.jsonl");
            index.sync_all().unwrap();
            sessions.insert_idle_for_test("s1", None, Some("x"), NoSink);
            let stopped = std::cell::RefCell::new(Vec::new());
            delete_session(
                &sessions,
                &index,
                &IndexNotifier::default(),
                &copy,
                |k| stopped.borrow_mut().push(k.to_owned()),
                |p| std::fs::remove_file(p),
            )
            .unwrap();
            assert!(stopped.borrow().is_empty());
            assert!(!Path::new(&copy).exists());
            assert!(sessions.session_id("s1").is_some());
        }

        #[test]
        fn remove_failure_keeps_index_entry() {
            let (_tmp, dir, index, sessions) = setup();
            let path = write_session(&dir, "a.jsonl");
            std::fs::write(&path, format!("{}{}\n", std::fs::read_to_string(&path).unwrap(),
                "{\"type\":\"message\",\"id\":\"m\",\"parentId\":null,\"timestamp\":\"2026-11-03T00:00:00.000Z\",\"message\":{\"role\":\"user\",\"content\":\"hi\",\"timestamp\":1}}")).unwrap();
            index.sync_all().unwrap();
            let err = delete_session(
                &sessions,
                &index,
                &IndexNotifier::default(),
                &path,
                no_stop,
                |_| Err(io::Error::other("busy")),
            )
            .unwrap_err();
            assert_eq!(err.code, None);
            assert_eq!(index.list(None, None).unwrap().items.len(), 1);
        }
    }

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

/// 工作区所在 Git 仓库的当前分支（只读，直接读 `.git/HEAD`）；不是仓库时返回 `null`。
#[tauri::command(async)]
pub(crate) fn git_branch(workspace: String) -> Option<crate::git::GitBranch> {
    let path = Path::new(&workspace);
    if workspace.is_empty() || !path.is_absolute() {
        return None;
    }
    crate::git::branch(path)
}

/// 输入框图片附件与右栏图片预览：读取本地图片，在内存中按最长边 `max_edge` 缩小并编码为 base64，附带缩略图（不写任何文件）。
/// 预览的路径来自助手回复（不可信）：读取前做与 `open_path` 相同的本机路径校验，拒绝网址、UNC / 设备路径
/// （读取 UNC 路径的元数据就会向对方服务器发起 SMB 认证）与控制字符。
#[tauri::command(async)]
pub(crate) fn attachment_image(
    path: String,
    max_edge: u32,
) -> Result<crate::attachments::AttachmentImage, String> {
    let checked = crate::open_path::check_path(&path)?;
    crate::attachments::read_image(&checked.path, max_edge)
}

/// 语音转文字是否可用（构建时注入了识别服务的密钥）。
#[tauri::command]
pub(crate) fn speech_available(speech: State<'_, crate::platform::speech::Speech>) -> bool {
    speech.available()
}

/// 开始语音转文字：识别事件（interim / final / error / end）经 Channel 推送；已有会话时先结束旧的。
/// 出错只推 `error`（文案固定为“语音转文字暂不可用”），随后 `end`。返回会话编号，音频与停止请求都要带上。
#[tauri::command]
pub(crate) fn speech_start(
    speech: State<'_, crate::platform::speech::Speech>,
    on_event: Channel<crate::platform::speech::SpeechEvent>,
) -> u64 {
    speech.start(Arc::new(move |event| {
        let _ = on_event.send(event);
    }))
}

/// 麦克风音频请求头里的会话编号
const SPEECH_SESSION_HEADER: &str = "x-speech-session";

/// 麦克风音频：请求体为原始字节（16 kHz、16 位、单声道、小端 PCM），请求头 `x-speech-session` 为会话编号。
/// 自定义协议不可用、Tauri 回退到 postMessage 时请求体是字节数组的 JSON（`[0, 255, …]`），严格校验后照收。
#[tauri::command]
pub(crate) fn speech_audio(
    speech: State<'_, crate::platform::speech::Speech>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let session = request
        .headers()
        .get(SPEECH_SESSION_HEADER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or_else(|| "缺少语音会话编号".to_string())?;
    match request.body() {
        tauri::ipc::InvokeBody::Raw(pcm) => {
            speech.audio(session, pcm);
            Ok(())
        }
        tauri::ipc::InvokeBody::Json(value) => {
            let pcm = primus_asr::audio::pcm_from_json(value)
                .ok_or_else(|| "音频必须是字节数组".to_string())?;
            speech.audio(session, &pcm);
            Ok(())
        }
    }
}

/// 停止录音（已录的音频识别完后推送 `end`）；只停 `session` 这个会话。
#[tauri::command]
pub(crate) fn speech_stop(speech: State<'_, crate::platform::speech::Speech>, session: u64) {
    speech.stop(session);
}

// ---- 能力中心：技能与 MCP（ADR 0017） ----

/// 能力中心命令的错误：`code` 供前端区分（`exists`：同名技能需确认覆盖；`conflict`：mcp.json 已在别处被修改），
/// 其余为 `null`；`message` 是界面文案。
#[derive(Debug, serde::Serialize)]
pub(crate) struct CapabilityError {
    code: Option<&'static str>,
    message: String,
}

impl From<crate::skills::SkillError> for CapabilityError {
    fn from(e: crate::skills::SkillError) -> Self {
        Self {
            code: e.code(),
            message: e.to_string(),
        }
    }
}

impl From<crate::mcp_config::McpConfigError> for CapabilityError {
    fn from(e: crate::mcp_config::McpConfigError) -> Self {
        Self {
            code: e.code(),
            message: e.to_string(),
        }
    }
}

impl From<String> for CapabilityError {
    fn from(message: String) -> Self {
        Self {
            code: None,
            message,
        }
    }
}

/// 技能的安装来源。
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum SkillSource {
    /// GitHub 仓库、`tree/` 或 `blob/` 链接
    Github { url: String },
    /// 本地 `.zip` 文件
    Zip { path: String },
    /// 本地文件夹
    Folder { path: String },
}

/// 下载 GitHub 仓库压缩包的时限。
const GITHUB_DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// 从 codeload 下载仓库压缩包：只走 https，重定向只允许留在 codeload.github.com，边下边数字节，超过上限即停。
async fn download_github_zip(url: &str) -> Result<Vec<u8>, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("Primus/", env!("CARGO_PKG_VERSION")))
        .timeout(GITHUB_DOWNLOAD_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let ok = attempt.previous().len() < 5
                && attempt.url().scheme() == "https"
                && attempt.url().host_str() == Some("codeload.github.com");
            if ok { attempt.follow() } else { attempt.stop() }
        }))
        .build()
        .map_err(|_| "无法创建网络客户端".to_owned())?;
    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载失败：{e}"))?;
    match resp.status().as_u16() {
        200 => {}
        404 => return Err("找不到这个仓库或分支（私有仓库无法直接下载）".into()),
        code => return Err(format!("下载失败：HTTP {code}")),
    }
    let limit = crate::skill_archive::MAX_ARCHIVE_BYTES;
    let too_large = || format!("压缩包超过 {} MiB", limit / 1024 / 1024);
    if resp.content_length().is_some_and(|n| n > limit) {
        return Err(too_large());
    }
    let mut data = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("下载失败：{e}"))? {
        if (data.len() + chunk.len()) as u64 > limit {
            return Err(too_large());
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}

/// 已安装的技能：Core 用户目录 `skills/` 与 `~/.agents/skills`（ADR 0017）。
#[tauri::command(async)]
pub(crate) fn skills_list(paths: State<'_, DataPaths>) -> Vec<crate::skills::SkillInfo> {
    let settings = crate::core_config::read_settings(&paths.core_dir());
    crate::skills::list(
        &paths.core_dir(),
        crate::skills::home_dir().as_deref(),
        &settings,
    )
}

/// 把来源解到暂存目录，按 Core 的规则列出其中的全部技能（GitHub 链接经 codeload 下载 zip）。
#[tauri::command]
pub(crate) async fn skill_stage(
    paths: State<'_, DataPaths>,
    source: SkillSource,
) -> Result<crate::skills::SkillStage, CapabilityError> {
    let tmp = paths.tmp_dir();
    match source {
        SkillSource::Github { url } => {
            let (owner, repo, reference, sub) = crate::skills::parse_github_url(&url)?;
            let zip_url = crate::skills::codeload_url(&owner, &repo, reference.as_deref());
            let data = download_github_zip(&zip_url).await?;
            tauri::async_runtime::spawn_blocking(move || {
                crate::skills::stage_zip(&tmp, &data, &repo, sub.as_deref())
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(Into::into)
        }
        SkillSource::Zip { path } => tauri::async_runtime::spawn_blocking(move || {
            crate::skills::stage_zip_file(&tmp, Path::new(&path))
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into),
        SkillSource::Folder { path } => tauri::async_runtime::spawn_blocking(move || {
            crate::skills::stage_folder(&tmp, Path::new(&path))
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into),
    }
}

/// 把暂存的整个来源装进用户目录 `skills/<name>`，其中的技能由 Core 按自己的规则全部加载（`overwrite` 为假且
/// 已有同名目录时以 code `exists` 拒绝）；返回安装后的目录。
#[tauri::command(async)]
pub(crate) fn skill_install(
    paths: State<'_, DataPaths>,
    stage_id: String,
    name: String,
    overwrite: bool,
) -> Result<String, CapabilityError> {
    let dir = crate::skills::install(
        &paths.core_dir(),
        &paths.tmp_dir(),
        &stage_id,
        &name,
        overwrite,
    )?;
    Ok(dir.to_string_lossy().into_owned())
}

/// 放弃一次暂存（取消安装）。
#[tauri::command(async)]
pub(crate) fn skill_discard(
    paths: State<'_, DataPaths>,
    stage_id: String,
) -> Result<(), CapabilityError> {
    Ok(crate::skills::discard(&paths.tmp_dir(), &stage_id)?)
}

/// 删除用户目录下的技能（链接只删链接本身）。
#[tauri::command(async)]
pub(crate) fn skill_delete(
    paths: State<'_, DataPaths>,
    file: String,
) -> Result<(), CapabilityError> {
    Ok(crate::skills::delete(
        &paths.core_dir(),
        crate::skills::home_dir().as_deref(),
        &file,
    )?)
}

/// 启用或停用技能：改写 Core 设置 `settings.json` 的 `skills`（新会话或 /reload 后生效）。
#[tauri::command(async)]
pub(crate) fn skill_set_enabled(
    paths: State<'_, DataPaths>,
    file: String,
    enabled: bool,
) -> Result<(), CapabilityError> {
    let core = paths.core_dir();
    let (path, base, _, _) =
        crate::skills::locate(&core, crate::skills::home_dir().as_deref(), &file)?;
    let mut settings =
        crate::core_config::read_settings_strict(&core).map_err(|e| e.to_string())?;
    if crate::skills::apply_enabled(&mut settings, &path, &base, enabled)? {
        crate::core_config::write_settings(&core, &settings).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 读取用户级 `mcp.json`（原文与版本），并附带只读的 `~/.agents/mcp.json`（ADR 0022）。
#[tauri::command(async)]
pub(crate) fn mcp_config_read(
    paths: State<'_, DataPaths>,
) -> Result<crate::mcp_config::McpConfigFile, CapabilityError> {
    Ok(crate::mcp_config::read(
        &paths.core_dir(),
        crate::skills::home_dir().as_deref(),
    )?)
}

/// 写入用户级 `mcp.json`：`version` 须是读出时的版本，文件已被别处修改时以 code `conflict` 拒绝；返回新版本。
#[tauri::command(async)]
pub(crate) fn mcp_config_write(
    paths: State<'_, DataPaths>,
    text: String,
    version: String,
) -> Result<String, CapabilityError> {
    Ok(crate::mcp_config::write(
        &paths.core_dir(),
        &text,
        &version,
    )?)
}

/// `mcp list --json` 的时限：逐个连接已启用的服务器（连接测试）。
const MCP_LIST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
/// `mcp login` 的时限（Core 默认等浏览器回调 300 秒，再留出连接的时间）。
const MCP_LOGIN_SECONDS: u64 = 300;
const MCP_LOGOUT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// MCP 服务器名：与 Core 一致，只允许字母、数字、`_`、`-`。
fn check_mcp_name(name: &str) -> Result<(), CapabilityError> {
    let ok = !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok {
        Ok(())
    } else {
        Err(format!("MCP 服务器名无效：{name}").into())
    }
}

/// 在阻塞线程池上运行 Core 命令行：`run_cli` 会等子进程结束（最长数分钟），不能占住异步运行时的工作线程。
async fn run_cli_blocking(
    app: tauri::AppHandle,
    args: Vec<String>,
    timeout: std::time::Duration,
) -> Result<crate::supervisor::CliOutput, CapabilityError> {
    tauri::async_runtime::spawn_blocking(move || {
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        app.state::<Supervisor>()
            .run_cli(&args, timeout)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(Into::into)
}

/// 列出 MCP 服务器并测试连接（Core 命令行 `mcp list --json`，超时 60 秒）。
#[tauri::command]
pub(crate) async fn mcp_list(
    app: tauri::AppHandle,
) -> Result<crate::supervisor::CliOutput, CapabilityError> {
    let args = ["mcp", "list", "--json"].map(String::from).to_vec();
    run_cli_blocking(app, args, MCP_LIST_TIMEOUT).await
}

/// OAuth 登录（Core 命令行 `mcp login`，Core 自己打开系统浏览器并等回调）。
#[tauri::command]
pub(crate) async fn mcp_login(
    app: tauri::AppHandle,
    name: String,
) -> Result<crate::supervisor::CliOutput, CapabilityError> {
    check_mcp_name(&name)?;
    let timeout = MCP_LOGIN_SECONDS.to_string();
    let args = ["mcp", "login", "--timeout", &timeout, "--", &name]
        .map(String::from)
        .to_vec();
    run_cli_blocking(
        app,
        args,
        std::time::Duration::from_secs(MCP_LOGIN_SECONDS + 30),
    )
    .await
}

/// 删除已保存的 OAuth 凭据（Core 命令行 `mcp logout`）。
#[tauri::command]
pub(crate) async fn mcp_logout(
    app: tauri::AppHandle,
    name: String,
) -> Result<crate::supervisor::CliOutput, CapabilityError> {
    check_mcp_name(&name)?;
    let args = ["mcp", "logout", "--", &name].map(String::from).to_vec();
    run_cli_blocking(app, args, MCP_LOGOUT_TIMEOUT).await
}
