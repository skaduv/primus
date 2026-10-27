// 平台接口层入口（第 16.1.1 节）。
// - 在 Tauri 窗口内加载 tauri/ 实现；在浏览器（next dev）里加载 mock/ 实现，用脚本化的假 Core 事件流预览。
// - 只有 tauri/ 目录可以 import `@tauri-apps/*`（scripts/check-tauri-imports.mjs 检查）。
// - 两套实现都用动态 import 按需加载，浏览器预览不会执行 Tauri 代码。
import type { Platform } from "./types";
import type { WindowControls } from "./window";

export * from "./types";
export type { WindowControls } from "./window";

/** 是否运行在 Tauri 窗口内（Tauri 2 注入 `globalThis.isTauri`） */
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
