import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { maximized: false, fullscreen: false };
let resized: (() => void) | null = null;
const win = {
  isMaximized: vi.fn(async () => state.maximized),
  isFullscreen: vi.fn(async () => state.fullscreen),
  setMinSize: vi.fn(async (_s: unknown) => {}),
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
    expect((win.setMinSize.mock.calls[0]?.[0] as { width: number }).width).toBe(1200);
    // 没有变化时不重复设置
    resized?.();
    await flush();
    expect(win.setMinSize).toHaveBeenCalledTimes(1);
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
