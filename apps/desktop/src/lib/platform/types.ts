import type { CoreBatch, RpcCommand } from "@primus/protocol";

// 平台接口（附录 B 薄壳命令）。前端只依赖这里的类型，不直接依赖 Tauri。
// 返回值中细节尚未定稿的字段先用宽松类型，随对应模块落地再收紧。

export interface AppInfo {
  appVersion: string;
  coreVersion: string;
  dataDir: string;
  platform: string;
  /** 运行环境：真实薄壳或浏览器预览用的 mock */
  runtime: "tauri" | "mock";
}

export interface WorkspaceInfo {
  path: string;
  name: string;
  trusted: boolean;
}

export interface SessionSummary {
  path: string;
  name?: string;
  workspace: string;
  updatedAt: number;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface SessionHandle {
  sessionKey: string;
}

export type BatchListener = (batch: CoreBatch) => void;

export interface ProviderConfig {
  id: string;
  /** 两协议：Anthropic Messages / OpenAI 兼容 */
  protocol: "anthropic" | "openai";
  baseUrl: string;
  name?: string;
  /** 只在保存时传入，薄壳写入 Vault 后不再回传 */
  apiKey?: string;
}

export interface FsEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Platform {
  appInfo(): Promise<AppInfo>;

  workspaceOpen(path: string): Promise<WorkspaceInfo>;
  workspaceList(): Promise<WorkspaceInfo[]>;
  workspaceTrust(path: string, trusted: boolean): Promise<void>;

  /** 系统文件夹对话框；取消时返回 null */
  dialogPickFolder(): Promise<string | null>;
  /** 系统文件对话框（可多选）；只返回本地路径，文件不复制 */
  dialogPickFiles(): Promise<string[]>;

  sessionList(workspace: string, cursor?: string): Promise<Page<SessionSummary>>;
  sessionSearch(workspace: string, query: string): Promise<SessionSummary[]>;
  /** 分配或启动 Core 进程；`onBatch` 接收该会话的事件批次（第 7.3 节） */
  sessionOpen(
    workspace: string,
    sessionPath: string | undefined,
    onBatch: BatchListener,
  ): Promise<SessionHandle>;
  sessionClose(sessionKey: string): Promise<void>;
  sessionDelete(sessionPath: string): Promise<void>;
  sessionArchive(sessionPath: string): Promise<void>;

  /** 写入 Core 的 stdin；响应与事件经 `sessionOpen` 的批次返回 */
  coreSend(sessionKey: string, record: RpcCommand | { type: string; id: string }): Promise<void>;
  coreRestart(sessionKey: string): Promise<void>;

  settingsGet(): Promise<Record<string, unknown>>;
  settingsSet(patch: Record<string, unknown>): Promise<void>;

  providerSave(config: ProviderConfig): Promise<void>;
  providerDelete(id: string): Promise<void>;
  providerTest(config: ProviderConfig): Promise<{ ok: boolean; message?: string }>;

  shellDetect(): Promise<unknown>;
  fsTree(workspace: string, path: string): Promise<FsEntry[]>;
  fsRead(workspace: string, path: string): Promise<string>;
  gitStatus(workspace: string): Promise<unknown>;
  gitDiff(workspace: string, path?: string): Promise<string>;

  terminalOpen(cwd: string, onData: (data: string) => void): Promise<{ terminalId: string }>;
  terminalWrite(terminalId: string, data: string): Promise<void>;
  terminalResize(terminalId: string, cols: number, rows: number): Promise<void>;
  terminalClose(terminalId: string): Promise<void>;

  openExternal(target: string): Promise<void>;
  storageUsage(): Promise<Record<string, number>>;
  storageClean(category: string): Promise<void>;
  diagnosticsExport(options?: Record<string, unknown>): Promise<string>;
  updateCheck(channel?: string): Promise<unknown>;
  updateInstall(): Promise<void>;
  logWrite(level: LogLevel, message: string): Promise<void>;
}

/** Platform 方法名 → 薄壳命令名（附录 B）。tauri 实现按此表 invoke；测试用它核对覆盖面 */
export const COMMANDS = {
  appInfo: "app_info",
  workspaceOpen: "workspace_open",
  workspaceList: "workspace_list",
  workspaceTrust: "workspace_trust",
  dialogPickFolder: "dialog_pick_folder",
  dialogPickFiles: "dialog_pick_files",
  sessionList: "session_list",
  sessionSearch: "session_search",
  sessionOpen: "session_open",
  sessionClose: "session_close",
  sessionDelete: "session_delete",
  sessionArchive: "session_archive",
  coreSend: "core_send",
  coreRestart: "core_restart",
  settingsGet: "settings_get",
  settingsSet: "settings_set",
  providerSave: "provider_save",
  providerDelete: "provider_delete",
  providerTest: "provider_test",
  shellDetect: "shell_detect",
  fsTree: "fs_tree",
  fsRead: "fs_read",
  gitStatus: "git_status",
  gitDiff: "git_diff",
  terminalOpen: "terminal_open",
  terminalWrite: "terminal_write",
  terminalResize: "terminal_resize",
  terminalClose: "terminal_close",
  openExternal: "open_external",
  storageUsage: "storage_usage",
  storageClean: "storage_clean",
  diagnosticsExport: "diagnostics_export",
  updateCheck: "update_check",
  updateInstall: "update_install",
  logWrite: "log_write",
} as const satisfies Record<keyof Platform, string>;
