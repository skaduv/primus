import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { maximized: false, fullscreen: false };
let resized: (() => void) | null = null;
const win = {
  isMaximized: vi.fn(async () => state.maximized),
  isFullscreen: vi.fn(async () => state.fullscreen),
  setMinSize: vi.fn(async (_s: unknown) => {}),
  setEffects: vi.fn(async (_e: unknown) => {}),
  clearEffects: vi.fn(async () => {}),
  onResized: vi.fn(async (cb: () => void) => {
    resized = cb;
    return () => {};
  }),
};
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => win,
  Effect: { Acrylic: "acrylic" },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));

const { createTauriWindowControls } = await import("./window");
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Tauri 窗口控制", () => {
  beforeEach(() => {
    state.maximized = false;
    state.fullscreen = false;
    win.setMinSize.mockClear();
  });

  it("最大化 / 全屏时不设最小宽度（会退出最大化），还原后补上", async () => {
    const c = createTauriWindowControls();
    state.maximized = true;
    await c.setMinWidth(900);
    state.maximized = false;
    state.fullscreen = true;
    await c.setMinWidth(1200);
    expect(win.setMinSize).not.toHaveBeenCalled();
    state.fullscreen = false;
    resized?.();
    await flush();
    expect(win.setMinSize).toHaveBeenCalledTimes(1);
    expect(win.setMinSize.mock.calls[0]?.[0]).toMatchObject({ width: 1200 });
    // 没有变化时不重复设置
    resized?.();
    await flush();
    expect(win.setMinSize).toHaveBeenCalledTimes(1);
  });

  it("设置进行中又改了目标：完成后接着设置最新目标", async () => {
    const c = createTauriWindowControls();
    let release: () => void = () => {};
    win.setMinSize.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const first = c.setMinWidth(1200);
    await flush();
    const second = c.setMinWidth(900);
    release();
    await Promise.all([first, second]);
    expect(win.setMinSize.mock.calls.map((x) => (x[0] as { width: number }).width)).toEqual([
      1200, 900,
    ]);
  });

  it("全屏时不伸缩窗口，按铺满屏幕上报", async () => {
    const c = createTauriWindowControls();
    state.fullscreen = true;
    expect(await c.animateWidth(100, 10, (t) => t)).toBe(false);
    const seen: boolean[] = [];
    await c.onMaximizedChange((m) => seen.push(m));
    expect(seen).toEqual([true]);
  });
});

describe("isLegacyWindows", () => {
  const setUA = (v: unknown) =>
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      value: v === undefined ? undefined : { getHighEntropyValues: async () => v },
    });

  it("Win10 的 platformVersion 主版本低于 13，Win11 为 13 及以上", async () => {
    const { isLegacyWindows } = await import("./window");
    setUA({ platform: "Windows", platformVersion: "10.0.0" });
    expect(await isLegacyWindows()).toBe(true);
    setUA({ platform: "Windows", platformVersion: "15.0.0" });
    expect(await isLegacyWindows()).toBe(false);
    setUA({ platform: "macOS", platformVersion: "10.15.7" });
    expect(await isLegacyWindows()).toBe(false);
    setUA(undefined);
    expect(await isLegacyWindows()).toBe(false);
  });

  it("Win10 上不开亚克力", async () => {
    setUA({ platform: "Windows", platformVersion: "10.0.0" });
    win.setEffects.mockClear();
    await createTauriWindowControls().setAcrylic(true);
    expect(win.setEffects).not.toHaveBeenCalled();
    expect(win.clearEffects).toHaveBeenCalled();
    setUA({ platform: "Windows", platformVersion: "15.0.0" });
    await createTauriWindowControls().setAcrylic(true);
    expect(win.setEffects).toHaveBeenCalledTimes(1);
    setUA(undefined);
  });
});
