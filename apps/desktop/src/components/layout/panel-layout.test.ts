import { describe, expect, it } from "vitest";
import {
  BOTTOM_DRAWER,
  CENTER_MIN_HEIGHT,
  CENTER_MIN_WIDTH,
  COMPOSER_RESERVE_HEIGHT,
  HANDLE_SIZE,
  LEFT_PANEL,
  type PanelPrefs,
  RIGHT_PANEL,
  resolvePanelLayout,
  SHELL_PADDING,
  TITLEBAR_GAP,
  TITLEBAR_HEIGHT,
} from "./panel-layout";

// 第 16.2 节：最小窗口 960×640 到 2560×1440 的常见尺寸（含 Windows 常见缩放后的逻辑分辨率）
const VIEWPORTS = [
  [960, 640],
  [1024, 768],
  [1280, 720],
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1920, 1080],
  [2560, 1080],
  [2560, 1440],
] as const;

const defaults: PanelPrefs = {
  leftOpen: true,
  leftWidth: LEFT_PANEL.initial,
  rightOpen: true,
  rightWidth: RIGHT_PANEL.initial,
  drawerOpen: true,
  drawerHeight: BOTTOM_DRAWER.initial,
};

/** 各栏开关与尺寸（下限、默认、上限、越界值）的全部组合 */
function* allPrefs(): Generator<PanelPrefs> {
  const bools = [true, false];
  const widthsL = [0, LEFT_PANEL.min, LEFT_PANEL.initial, LEFT_PANEL.max, 5000];
  const widthsR = [0, RIGHT_PANEL.min, RIGHT_PANEL.initial, RIGHT_PANEL.max, 5000];
  const heights = [0, BOTTOM_DRAWER.min, BOTTOM_DRAWER.initial, BOTTOM_DRAWER.max, 5000];
  for (const leftOpen of bools)
    for (const rightOpen of bools)
      for (const drawerOpen of bools)
        for (const leftWidth of widthsL)
          for (const rightWidth of widthsR)
            for (const drawerHeight of heights)
              yield { leftOpen, rightOpen, drawerOpen, leftWidth, rightWidth, drawerHeight };
}

describe("resolvePanelLayout", () => {
  it("最小窗口 960×640 下默认三栏与抽屉原样放下，中央不小于下限", () => {
    const r = resolvePanelLayout({ width: 960, height: 640 }, defaults);
    expect(r.left.size).toBe(232);
    expect(r.right.size).toBe(300);
    expect(r.drawer.size).toBe(BOTTOM_DRAWER.initial);
    expect(r.center?.width).toBe(960 - 2 * SHELL_PADDING - 2 * HANDLE_SIZE - 232 - 300);
    expect(r.center?.width).toBeGreaterThanOrEqual(CENTER_MIN_WIDTH);
    expect(r.center?.height).toBeGreaterThanOrEqual(CENTER_MIN_HEIGHT);
  });

  it.each(VIEWPORTS)("%i×%i：任意开关与尺寸组合都不错位", (width, height) => {
    const innerWidth = width - 2 * SHELL_PADDING;
    const innerHeight = height - SHELL_PADDING - TITLEBAR_HEIGHT - TITLEBAR_GAP;
    for (const prefs of allPrefs()) {
      const r = resolvePanelLayout({ width, height }, prefs);
      const handlesX = (prefs.leftOpen ? HANDLE_SIZE : 0) + (prefs.rightOpen ? HANDLE_SIZE : 0);
      const handlesY = prefs.drawerOpen ? HANDLE_SIZE : 0;
      const center = r.center;
      expect(center).not.toBeNull();
      if (!center) continue;
      // 横向：左栏 + 拖动条 + 中央 + 右栏恰好铺满，中央不小于下限
      expect(r.left.size + r.right.size + handlesX + center.width).toBe(innerWidth);
      expect(center.width).toBeGreaterThanOrEqual(CENTER_MIN_WIDTH);
      // 纵向：中央 + 拖动条 + 抽屉恰好铺满顶栏以下的空间，中央不小于下限
      expect(center.height + handlesY + r.drawer.size).toBe(innerHeight);
      expect(center.height).toBeGreaterThanOrEqual(CENTER_MIN_HEIGHT);
      // 每栏在自己的上下限之内；收起的栏尺寸为 0
      for (const [panel, limits, open] of [
        [r.left, LEFT_PANEL, prefs.leftOpen],
        [r.right, RIGHT_PANEL, prefs.rightOpen],
        [r.drawer, BOTTOM_DRAWER, prefs.drawerOpen],
      ] as const) {
        if (!open) {
          expect(panel.size).toBe(0);
          continue;
        }
        expect(Number.isInteger(panel.size)).toBe(true);
        expect(panel.size).toBeGreaterThanOrEqual(limits.min);
        expect(panel.size).toBeLessThanOrEqual(Math.min(limits.max, panel.max));
        expect(panel.min).toBeLessThanOrEqual(panel.max);
      }
    }
  });

  it("视口变窄时先压缩右栏、再压缩左栏，放大后恢复用户尺寸", () => {
    const wide = { ...defaults, leftWidth: LEFT_PANEL.max, rightWidth: RIGHT_PANEL.max };
    const small = resolvePanelLayout({ width: 960, height: 640 }, wide);
    expect(small.right.size).toBe(RIGHT_PANEL.min);
    expect(small.left.size).toBe(960 - 16 - 16 - RIGHT_PANEL.min - CENTER_MIN_WIDTH);
    const large = resolvePanelLayout({ width: 2560, height: 1440 }, wide);
    expect(large.left.size).toBe(LEFT_PANEL.max);
    expect(large.right.size).toBe(RIGHT_PANEL.max);
  });

  it("拖动条的上限随另一栏与视口变化，保证中央不被挤压", () => {
    const r = resolvePanelLayout({ width: 1280, height: 800 }, defaults);
    const inner = 1280 - 16 - 16;
    expect(r.left.max).toBe(Math.min(LEFT_PANEL.max, inner - r.right.size - CENTER_MIN_WIDTH));
    expect(r.right.max).toBe(Math.min(RIGHT_PANEL.max, inner - r.left.size - CENTER_MIN_WIDTH));
    // 抽屉不超过细标题栏以下可用高度的一半
    const innerHeight = 800 - SHELL_PADDING - TITLEBAR_HEIGHT - TITLEBAR_GAP - HANDLE_SIZE;
    expect(r.drawer.max).toBe(Math.floor(innerHeight / 2));
  });

  it("最小窗口 960×640 下抽屉拉到最大，中央仍能容纳悬浮输入框与至少一行内容", () => {
    const r = resolvePanelLayout({ width: 960, height: 640 }, { ...defaults, drawerHeight: 5000 });
    const innerHeight = 640 - SHELL_PADDING - TITLEBAR_HEIGHT - TITLEBAR_GAP - HANDLE_SIZE;
    // 此时中央高度的约束比"可用高度一半"更紧
    expect(innerHeight - CENTER_MIN_HEIGHT).toBeLessThan(Math.floor(innerHeight / 2));
    expect(r.drawer.max).toBe(innerHeight - CENTER_MIN_HEIGHT);
    expect(r.drawer.size).toBe(r.drawer.max);
    expect(r.center?.height).toBe(CENTER_MIN_HEIGHT);
    expect(CENTER_MIN_HEIGHT).toBeGreaterThan(COMPOSER_RESERVE_HEIGHT + 40);
    // 默认抽屉高度在最小窗口下仍原样放下
    expect(r.drawer.max).toBeGreaterThanOrEqual(BOTTOM_DRAWER.initial);
  });

  it("小于最小窗口时按最小窗口计算（外壳 min-width / min-height 出现滚动而不是挤压）", () => {
    const tiny = resolvePanelLayout({ width: 600, height: 400 }, defaults);
    const min = resolvePanelLayout({ width: 960, height: 640 }, defaults);
    expect(tiny).toEqual(min);
  });

  it("没有视口（静态导出预渲染）时只按各栏上下限夹住", () => {
    const r = resolvePanelLayout(null, { ...defaults, leftWidth: 10, rightWidth: 9999 });
    expect(r.left.size).toBe(LEFT_PANEL.min);
    expect(r.right.size).toBe(RIGHT_PANEL.max);
    expect(r.center).toBeNull();
  });
});
