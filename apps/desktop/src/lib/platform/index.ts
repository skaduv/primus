// 平台接口层入口（第 16.1.1 节）。
// - 在 Tauri 窗口内加载 tauri/ 实现；在浏览器（next dev）里加载 mock/ 实现，用脚本化的假 Core 事件流预览。
// - 只有 tauri/ 目录可以 import `@tauri-apps/*`（scripts/check-tauri-imports.mjs 检查）。
// - 两套实现都用动态 import 按需加载，浏览器预览不会执行 Tauri 代码。
import type { Platform } from "./types";
import type { WindowControls } from "./window";

export * from "./types";
export type { WindowControls } from "./window";

/** 是否运行在 Tauri 窗口内（Tauri 2 注入 `globalThis.isTauri`） */
/**
 * 是否能弹系统文件/文件夹对话框。薄壳尚未注册 dialog_pick_folder / dialog_pick_files（待接入 tauri-plugin-dialog），
 * Tauri 内为 false，界面隐藏"打开文件夹…"和附件入口；浏览器预览走 mock。接入后改为恒 true。
 */
export function canPickFiles(): boolean {
  return !isTauriRuntime();
}

/**
 * 是否能列出/打开工作区。薄壳尚未注册 workspace_list / workspace_open，Tauri 内为 false，
 * 界面隐藏工作区选择入口（会话以空路径打开）；浏览器预览走 mock。命令注册后改为恒 true。
 */
export function canUseWorkspaces(): boolean {
  return !isTauriRuntime();
}

export function isTauriRuntime(): boolean {
  return (globalThis as { isTauri?: unknown }).isTauri === true;
}

let current: Promise<Platform> | undefined;

/** 取得当前平台实现（单例）。只能在客户端代码（useEffect / 事件处理）中调用 */
export function getPlatform(): Promise<Platform> {
  current ??= isTauriRuntime()
    ? import("./tauri").then((m) => m.createTauriPlatform())
    : import("./mock").then((m) => m.createMockPlatform());
  return current;
}

let currentWindow: Promise<WindowControls | undefined> | undefined;

/**
 * 取得自绘标题栏用的窗口控制（单例）。浏览器预览返回 undefined：由浏览器提供窗口外框。
 * 只能在客户端代码（useEffect / 事件处理）中调用
 */
export function getWindowControls(): Promise<WindowControls | undefined> {
  currentWindow ??= isTauriRuntime()
    ? import("./tauri/window").then((m) => m.createTauriWindowControls())
    : Promise.resolve(undefined);
  return currentWindow;
}

/** 仅测试用：注入或重置平台实现 */
export function setPlatformForTesting(platform: Platform | undefined): void {
  current = platform ? Promise.resolve(platform) : undefined;
}

/** 仅测试用：注入或重置窗口控制 */
export function setWindowControlsForTesting(controls: WindowControls | undefined): void {
  currentWindow = controls ? Promise.resolve(controls) : undefined;
}
