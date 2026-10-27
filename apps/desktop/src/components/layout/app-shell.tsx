"use client";

import { PanelLeft, PanelRight } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChatPanel } from "@/features/chat/chat-panel";
import { getWindowControls, type WindowControls } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { BottomDrawer } from "./bottom-drawer";
import { InspectorPanel } from "./inspector-panel";
import {
  BOTTOM_DRAWER,
  CENTER_MIN_HEIGHT,
  CENTER_MIN_WIDTH,
  LEFT_PANEL,
  MIN_WINDOW,
  RIGHT_PANEL,
  resolvePanelLayout,
  SHELL_PADDING,
} from "./panel-layout";
import { ResizeHandle } from "./resize-handle";
import { OUTER_RADIUS, SEAM_NOTCH } from "./seam";
import { SessionsSidebar } from "./sessions-sidebar";
import { useViewportSize } from "./use-viewport-size";
import { WindowTitleBar } from "./window-controls";

const t = strings.layout;

// 主界面外壳（第 16.2 节），macOS 27 Liquid Glass 风格：
// 壁纸 → 细标题栏 → 浮动玻璃左栏 / 右栏（可拖动、可收起）→ 中央实色"纸面"时间线 → 通栏底部抽屉（终端 · 日志）。
// 主窗口去掉了系统标题栏：顶部细标题栏可拖动、双击最大化，右上角是自绘窗口按钮。
// 各栏尺寸由 resolvePanelLayout 按视口计算：最小窗口 960×640 到 2560×1440 中央区域都不小于下限、不错位。
export function AppShell() {
  const s = useAppStore();
  const viewport = useViewportSize();
  const layout = resolvePanelLayout(viewport, {
    leftOpen: s.sessionsPanelOpen,
    leftWidth: s.sessionsPanelWidth,
    rightOpen: s.inspectorPanelOpen,
    rightWidth: s.inspectorPanelWidth,
    drawerOpen: s.bottomDrawerOpen,
    drawerHeight: s.bottomDrawerHeight,
  });

  const center = useWindowChoreography(s.sessionsPanelOpen, s.inspectorPanelOpen, {
    left: s.sessionsPanelWidth,
    right: s.inspectorPanelWidth,
  });

  return (
    <div
      className="flex h-screen flex-col gap-2 overflow-hidden px-2 pb-2 text-fg"
      style={{ minWidth: MIN_WINDOW.width, minHeight: MIN_WINDOW.height }}
    >
      {/* 不再有顶栏：顶部只留一条可拖动窗口的细标题栏，窗口按钮贴在右上角 */}
      <WindowTitleBar className="-mx-2 h-9" />

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="flex min-h-0 flex-1 overflow-hidden"
          style={{ minHeight: CENTER_MIN_HEIGHT, justifyContent: center.anchor }}
        >
          <SnapSlot
            side="left"
            open={s.sessionsPanelOpen}
            size={layout.left.size}
            reserve={center.windowMode}
            hold={center.hold === "left"}
          >
            {(w) => <SessionsSidebar width={w} />}
          </SnapSlot>
          {s.sessionsPanelOpen && (
            <ResizeHandle
              orientation="vertical"
              label={t.resizeSessions}
              value={layout.left.size}
              min={layout.left.min}
              max={layout.left.max}
              direction={1}
              onResize={s.setSessionsPanelWidth}
              onReset={() => s.setSessionsPanelWidth(LEFT_PANEL.initial)}
              className={seamHandleClass}
            />
          )}
          <main
            ref={center.ref}
            aria-label={t.timeline}
            className={cn(
              "seam-mask relative flex min-h-0 flex-col overflow-hidden bg-[var(--paper)]",
              center.lockedWidth == null ? "flex-1" : "flex-none",
            )}
            style={{
              minWidth: CENTER_MIN_WIDTH,
              width: center.lockedWidth ?? undefined,
              ...seamStyle(s.sessionsPanelOpen, s.inspectorPanelOpen),
            }}
          >
            {/* 左右栏开关：对称贴在纸面左上角、右上角（圆角与纸面同心） */}
            <PanelToggle
              side="left"
              open={s.sessionsPanelOpen}
              label={s.sessionsPanelOpen ? t.hideSessions : t.showSessions}
              disabled={center.busy}
              onToggle={() => s.setSessionsPanelOpen(!s.sessionsPanelOpen)}
            />
            <PanelToggle
              side="right"
              open={s.inspectorPanelOpen}
              label={s.inspectorPanelOpen ? t.hideInspector : t.showInspector}
              disabled={center.busy}
              onToggle={() => s.setInspectorPanelOpen(!s.inspectorPanelOpen)}
            />
            <ChatPanel />
          </main>
          {s.inspectorPanelOpen && (
            <ResizeHandle
              orientation="vertical"
              label={t.resizeInspector}
              value={layout.right.size}
              min={layout.right.min}
              max={layout.right.max}
              direction={-1}
              onResize={s.setInspectorPanelWidth}
              onReset={() => s.setInspectorPanelWidth(RIGHT_PANEL.initial)}
              className={seamHandleClass}
            />
          )}
          <SnapSlot
            side="right"
            open={s.inspectorPanelOpen}
            size={layout.right.size}
            reserve={center.windowMode}
            hold={center.hold === "right"}
          >
            {(w) => <InspectorPanel width={w} />}
          </SnapSlot>
        </div>
        {layout.drawer.open && (
          <>
            <ResizeHandle
              orientation="horizontal"
              label={t.resizeDrawer}
              value={layout.drawer.size}
              min={layout.drawer.min}
              max={layout.drawer.max}
              direction={-1}
              onResize={s.setBottomDrawerHeight}
              onReset={() => s.setBottomDrawerHeight(BOTTOM_DRAWER.initial)}
            />
            <BottomDrawer height={layout.drawer.size} />
          </>
        )}
      </div>
    </div>
  );
}

/** 接缝上的拖动条：8px 命中区域用负边距叠在两块面板之间，不占宽度 */
const seamHandleClass = "-mx-1 z-20";

/** 吸附动画：快起慢停，像磁吸一样贴到中央纸面上；圆角、凹口、侧栏宽度、窗口宽度都用同一条曲线同步 */
export const SNAP_MS = 320;
const SNAP_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const SEAM_TRANSITION = `border-radius ${SNAP_MS}ms ${SNAP_EASE}, --nl ${SNAP_MS}ms ${SNAP_EASE}, --nr ${SNAP_MS}ms ${SNAP_EASE}`;

/** cubic-bezier(0.22, 1, 0.36, 1) 的 JS 版本，供窗口宽度动画与 CSS 过渡同步 */
export function snapEase(t: number): number {
  const [x1, y1, x2, y2] = [0.22, 1, 0.36, 1];
  const bez = (a: number, b: number, u: number) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (bez(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return bez(y1, y2, (lo + hi) / 2);
}

/** 中央纸面：贴着侧栏的一边变直角并刻出凹口，未贴侧栏的一边保持外侧圆角；随侧栏同步过渡 */
function seamStyle(leftOpen: boolean, rightOpen: boolean): CSSProperties {
  const l = leftOpen ? 0 : OUTER_RADIUS;
  const r = rightOpen ? 0 : OUTER_RADIUS;
  return {
    borderRadius: `${l}px ${r}px ${r}px ${l}px`,
    ["--nl" as string]: `${leftOpen ? SEAM_NOTCH : 0}px`,
    ["--nr" as string]: `${rightOpen ? SEAM_NOTCH : 0}px`,
    // 描边只画在不贴侧栏的边上，接缝处不留线
    boxShadow: [
      "0 8px 30px -14px rgb(0 0 0 / 0.3)",
      "inset 0 1px 0 var(--color-border)",
      "inset 0 -1px 0 var(--color-border)",
      leftOpen ? null : "inset 1px 0 0 var(--color-border)",
      rightOpen ? null : "inset -1px 0 0 var(--color-border)",
    ]
      .filter(Boolean)
      .join(", "),
    transition: SEAM_TRANSITION,
  };
}

/**
 * 中央界面不变宽：开关侧栏时窗口向该侧伸缩同样宽度。动作严格按先后进行：
 *   展开：锁住中央像素宽度 → 窗口先向该侧加宽（新空出的地方暂时空着）→ 侧栏从接缝向外长出 → 解锁
 *   收起：锁住中央 → 侧栏收回接缝 → 窗口再向该侧收窄 → 解锁
 * 一次开关进行中按钮禁用，避免动画叠加。窗口目标宽度按"记住的中央宽度 + 已开侧栏"计算，
 * 不累加增量，反复开关不会越来越大；用户手动改窗口或拖动侧栏后重新记住中央宽度。
 * 最大化或浏览器预览下窗口不能变，退回到中央随侧栏伸缩（windowMode=false）。
 */
function useWindowChoreography(
  leftOpen: boolean,
  rightOpen: boolean,
  widths: { left: number; right: number },
) {
  const ref = useRef<HTMLElement>(null);
  const controls = useRef<WindowControls | undefined>(undefined);
  const [maximized, setMaximized] = useState(false);
  const [hasWindow, setHasWindow] = useState(false);
  const prev = useRef({ left: leftOpen, right: rightOpen });
  const centerWidth = useRef<number | null>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<"flex-start" | "flex-end">("flex-start");
  const [hold, setHold] = useState<"left" | "right" | null>(null);
  const windowMode = hasWindow && !maximized;
  // 只在开关状态变化时编排；宽度与窗口模式取最新值即可
  const latest = useRef({ widths, windowMode });
  latest.current = { widths, windowMode };

  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void getWindowControls().then(async (c) => {
      if (!alive || !c) return;
      controls.current = c;
      setHasWindow(true);
      off = await c.onMaximizedChange(setMaximized);
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  // 中央宽度被用户改变（拖侧栏、改窗口大小）时重新记住；编排过程中的变化不算
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!busyRef.current) centerWidth.current = null;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const p = prev.current;
    prev.current = { left: leftOpen, right: rightOpen };
    const c = controls.current;
    const side = p.left !== leftOpen ? "left" : p.right !== rightOpen ? "right" : null;
    if (!side || !c || !latest.current.windowMode) return;
    const widths = latest.current.widths;
    const opening = side === "left" ? leftOpen : rightOpen;
    const main = ref.current;
    if (!main) return;
    const current = main.offsetWidth;
    if (centerWidth.current == null) centerWidth.current = current;
    const target =
      centerWidth.current +
      SHELL_PADDING * 2 +
      (leftOpen ? widths.left : 0) +
      (rightOpen ? widths.right : 0);
    const delta = target - window.innerWidth;

    busyRef.current = true;
    setBusy(true);
    setLockedWidth(current);
    setAnchor(side === "left" ? "flex-end" : "flex-start");
    if (opening) setHold(side);

    let alive = true;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    void (async () => {
      if (opening) {
        await c.growBySide(side, delta);
        await frame();
        if (!alive) return;
        setHold(null);
        await wait(SNAP_MS + 40);
      } else {
        await wait(SNAP_MS + 40);
        if (!alive) return;
        await c.growBySide(side, delta);
        await frame();
      }
      if (!alive) return;
      setLockedWidth(null);
      setAnchor("flex-start");
      await frame();
      busyRef.current = false;
      setBusy(false);
    })();
    return () => {
      alive = false;
      busyRef.current = false;
      setBusy(false);
      setHold(null);
      setLockedWidth(null);
      setAnchor("flex-start");
    };
  }, [leftOpen, rightOpen]);

  return { ref, lockedWidth, anchor, hold, busy, windowMode };
}

/**
 * 侧栏插槽：展开时宽度从 0 弹到目标宽度，面板内容贴着接缝一侧，看起来是从中央纸面背后滑出并吸附；
 * 收起时反向收回后再卸载。拖动调宽时不加过渡，跟手。
 */
function SnapSlot({
  side,
  open,
  size,
  reserve,
  hold,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  size: number;
  /** 窗口模式：外层始终占住侧栏宽度（空间由窗口伸缩提供），只有内层从接缝长出/收回 */
  reserve: boolean;
  /** 窗口还没加宽完：先占位不展开 */
  hold: boolean;
  children: (width: number) => ReactNode;
}) {
  const last = useRef(size);
  if (open && size > 0) last.current = size;
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  const [animating, setAnimating] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (open && hold) {
      setMounted(true);
      setShown(false);
      return;
    }
    setAnimating(true);
    let frame = 0;
    if (open) {
      setMounted(true);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setShown(true));
      });
    } else {
      setShown(false);
    }
    const timer = setTimeout(() => {
      setAnimating(false);
      if (!open) setMounted(false);
    }, SNAP_MS + 20);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [open, hold]);

  if (!mounted) return null;
  const width = open && size > 0 ? size : last.current;
  const inner = (
    <div
      className={cn(
        "flex min-h-0 shrink-0",
        side === "left" ? "justify-end" : "justify-start",
        animating && "overflow-hidden",
      )}
      style={{
        width: shown ? width : 0,
        transition: animating ? `width ${SNAP_MS}ms ${SNAP_EASE}` : undefined,
      }}
    >
      {children(width)}
    </div>
  );
  if (!reserve) return inner;
  // 宽度从 0 长到目标宽度（或反向收回），内容贴着接缝一侧，像从中央纸面两侧向外长出来
  return (
    <div
      className={cn("flex min-h-0 shrink-0", side === "left" ? "justify-end" : "justify-start")}
      style={{ width }}
    >
      {inner}
    </div>
  );
}

function PanelToggle({
  side,
  open,
  label,
  onToggle,
  disabled = false,
}: {
  side: "left" | "right";
  open: boolean;
  label: string;
  onToggle: () => void;
  /** 一次开关动画进行中禁用，避免叠加 */
  disabled?: boolean;
}) {
  const Icon = side === "left" ? PanelLeft : PanelRight;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={open}
      onClick={() => {
        if (!disabled) onToggle();
      }}
      aria-disabled={disabled || undefined}
      className={cn(
        "absolute top-1.5 z-10 grid size-7 place-items-center rounded-[10px] text-muted transition-colors hover:bg-hover hover:text-fg aria-pressed:text-fg",
        side === "left" ? "left-1.5" : "right-1.5",
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} />
    </button>
  );
}
