// 主界面三栏 + 底部抽屉的尺寸规则（技术方案第 16.2 节）。纯函数，便于在各种视口下单测“不错位”。
//
//   ┌─────────────────────── 细标题栏（窗口按钮）──────────────────────┐
//   │ 左栏 ┃ 中央时间线                                  ┃ 右栏     │   ┃ = 拖动条（HANDLE）
//   ├━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┤
//   │ 底部抽屉（终端 · 日志）                                        │
//   └──────────────────────────────────────────────────────────────┘
//
// 用户拖出的尺寸保存在 store 中（只按各栏自身上下限夹住）；实际渲染尺寸再按当前视口收缩，
// 保证中央区域始终不小于 CENTER_MIN_*：视口变小时先压缩右栏，再压缩左栏，都到下限为止。
// 最小窗口 960×640（tauri.conf.json 的 minWidth / minHeight）下默认尺寸也放得下。

export interface PanelLimits {
  /** 默认尺寸（px），双击拖动条恢复 */
  initial: number;
  min: number;
  max: number;
}

/** 最小窗口（第 16.2 节），与 tauri.conf.json 一致 */
export const MIN_WINDOW = { width: 960, height: 640 } as const;
/** 外壳左右与底部内边距（px-2 pb-2）；顶部由细标题栏贴住窗口上沿 */
export const SHELL_PADDING = 8;
/** 细标题栏高度（h-9，与窗口按钮同高）与其下方间距（gap-2） */
export const TITLEBAR_HEIGHT = 36;
export const TITLEBAR_GAP = 8;
/** 拖动条宽度：同时充当栏间距 */
export const HANDLE_SIZE = 8;
/** 中央时间线的最小宽度 */
export const CENTER_MIN_WIDTH = 380;
/**
 * 中央时间线底部为悬浮输入框保留的高度：输入框静止高度约 104px + 下边距 16px + 与内容的间距 16px。
 * 实际留白由 ChatPanel 按输入框实测高度计算，这里取同一组数值用于限制抽屉上限。
 */
export const COMPOSER_RESERVE_HEIGHT = 136;
/** 时间线上内边距（pt-6） */
export const CENTER_PADDING_TOP = 24;
/** 输入框之上至少还要露出的内容：欢迎页标题、说明与一行建议按钮，或三四行消息 */
export const CENTER_CONTENT_MIN_HEIGHT = 160;
/** 中央时间线的最小高度：容纳悬浮输入框 + 至少一行内容（960×640 下据此限制抽屉上限） */
export const CENTER_MIN_HEIGHT =
  COMPOSER_RESERVE_HEIGHT + CENTER_PADDING_TOP + CENTER_CONTENT_MIN_HEIGHT;

/** 左栏：会话列表，默认 232px（第 16.2 节） */
export const LEFT_PANEL: PanelLimits = { initial: 232, min: 200, max: 400 };
/** 右栏：变更 · 文件 · 计划 */
export const RIGHT_PANEL: PanelLimits = { initial: 300, min: 240, max: 560 };
/** 底部抽屉：终端 · 日志；上限另受视口高度约束（不超过可用高度的一半，且给中央留出 CENTER_MIN_HEIGHT） */
export const BOTTOM_DRAWER: PanelLimits = { initial: 220, min: 120, max: 720 };
export const DRAWER_MAX_RATIO = 0.5;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(Math.round(value), min), max);

export interface PanelPrefs {
  leftOpen: boolean;
  leftWidth: number;
  rightOpen: boolean;
  rightWidth: number;
  drawerOpen: boolean;
  drawerHeight: number;
}

export interface ResolvedPanel {
  open: boolean;
  /** 实际渲染尺寸；收起时为 0 */
  size: number;
  /** 当前视口下拖动条允许的范围 */
  min: number;
  max: number;
}

export interface ResolvedLayout {
  left: ResolvedPanel;
  right: ResolvedPanel;
  drawer: ResolvedPanel;
  /** 中央区域的宽高（视口未知时为 null） */
  center: { width: number; height: number } | null;
}

/**
 * 按视口计算各栏实际尺寸。viewport 为 null（静态导出预渲染时没有窗口）时只按各栏上下限夹住。
 */
export function resolvePanelLayout(
  viewport: { width: number; height: number } | null,
  prefs: PanelPrefs,
): ResolvedLayout {
  let left = prefs.leftOpen ? clamp(prefs.leftWidth, LEFT_PANEL.min, LEFT_PANEL.max) : 0;
  let right = prefs.rightOpen ? clamp(prefs.rightWidth, RIGHT_PANEL.min, RIGHT_PANEL.max) : 0;
  const drawerPref = clamp(prefs.drawerHeight, BOTTOM_DRAWER.min, BOTTOM_DRAWER.max);

  if (!viewport) {
    return {
      left: { open: prefs.leftOpen, size: left, min: LEFT_PANEL.min, max: LEFT_PANEL.max },
      right: { open: prefs.rightOpen, size: right, min: RIGHT_PANEL.min, max: RIGHT_PANEL.max },
      drawer: {
        open: prefs.drawerOpen,
        size: prefs.drawerOpen ? drawerPref : 0,
        min: BOTTOM_DRAWER.min,
        max: BOTTOM_DRAWER.max,
      },
      center: null,
    };
  }

  // 窗口不会小于最小尺寸（外壳也有同样的 min-width / min-height，小于时出现滚动而不是挤压）
  const width = Math.max(viewport.width, MIN_WINDOW.width);
  const height = Math.max(viewport.height, MIN_WINDOW.height);

  const innerWidth = width - 2 * SHELL_PADDING;
  // 左右栏吸附在中央纸面上：拖动条叠在接缝上，不占宽度
  let overflow = left + right + CENTER_MIN_WIDTH - innerWidth;
  if (overflow > 0 && prefs.rightOpen) {
    const take = Math.min(overflow, right - RIGHT_PANEL.min);
    right -= take;
    overflow -= take;
  }
  if (overflow > 0 && prefs.leftOpen) {
    const take = Math.min(overflow, left - LEFT_PANEL.min);
    left -= take;
  }
  const leftMax = clamp(innerWidth - right - CENTER_MIN_WIDTH, LEFT_PANEL.min, LEFT_PANEL.max);
  const rightMax = clamp(innerWidth - left - CENTER_MIN_WIDTH, RIGHT_PANEL.min, RIGHT_PANEL.max);

  const innerHeight =
    height - SHELL_PADDING - TITLEBAR_HEIGHT - TITLEBAR_GAP - (prefs.drawerOpen ? HANDLE_SIZE : 0);
  const drawerMax = Math.max(
    BOTTOM_DRAWER.min,
    Math.min(
      BOTTOM_DRAWER.max,
      Math.floor(innerHeight * DRAWER_MAX_RATIO),
      innerHeight - CENTER_MIN_HEIGHT,
    ),
  );
  const drawer = prefs.drawerOpen ? clamp(drawerPref, BOTTOM_DRAWER.min, drawerMax) : 0;

  return {
    left: { open: prefs.leftOpen, size: left, min: LEFT_PANEL.min, max: leftMax },
    right: { open: prefs.rightOpen, size: right, min: RIGHT_PANEL.min, max: rightMax },
    drawer: { open: prefs.drawerOpen, size: drawer, min: BOTTOM_DRAWER.min, max: drawerMax },
    center: { width: innerWidth - left - right, height: innerHeight - drawer },
  };
}
