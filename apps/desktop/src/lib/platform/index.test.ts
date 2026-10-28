import { afterEach, describe, expect, it } from "vitest";
import {
  canPickFiles,
  canUseWorkspaces,
  getPlatform,
  getWindowControls,
  isTauriRuntime,
  setPlatformForTesting,
  setWindowControlsForTesting,
} from "./index";
import type { WindowControls } from "./window";

describe("平台选择", () => {
  afterEach(() => {
    setPlatformForTesting(undefined);
    setWindowControlsForTesting(undefined);
    delete (globalThis as { isTauri?: boolean }).isTauri;
  });

  it("浏览器中（无 Tauri 注入）使用 mock 实现，且为单例", async () => {
    expect(isTauriRuntime()).toBe(false);
    const p = await getPlatform();
    await expect(p.appInfo()).resolves.toMatchObject({ runtime: "mock" });
    expect(await getPlatform()).toBe(p);
  });

  it("识别 Tauri 2 注入的 isTauri 标记", () => {
    (globalThis as { isTauri?: boolean }).isTauri = true;
    expect(isTauriRuntime()).toBe(true);
  });

  it("能力开关：浏览器预览可用，Tauri 内未注册对应命令前关闭", () => {
    expect(canPickFiles()).toBe(true);
    expect(canUseWorkspaces()).toBe(true);
    (globalThis as { isTauri?: boolean }).isTauri = true;
    expect(canPickFiles()).toBe(false);
    expect(canUseWorkspaces()).toBe(false);
  });

  it("窗口控制：浏览器返回 undefined 且缓存；注入与重置生效", async () => {
    const first = getWindowControls();
    expect(getWindowControls()).toBe(first);
    await expect(first).resolves.toBeUndefined();

    const fake = { minimize: async () => {} } as unknown as WindowControls;
    setWindowControlsForTesting(fake);
    await expect(getWindowControls()).resolves.toBe(fake);

    setWindowControlsForTesting(undefined);
    await expect(getWindowControls()).resolves.toBeUndefined();
  });
});
