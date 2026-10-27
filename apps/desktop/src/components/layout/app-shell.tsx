"use client";

import { PanelLeft, PanelRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/features/chat/chat-panel";
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
} from "./panel-layout";
import { ResizeHandle } from "./resize-handle";
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

  return (
    <div
      className="flex h-screen flex-col gap-2 overflow-hidden px-2 pb-2 text-fg"
      style={{ minWidth: MIN_WINDOW.width, minHeight: MIN_WINDOW.height }}
    >
      {/* 不再有顶栏：顶部只留一条可拖动窗口的细标题栏，窗口按钮贴在右上角 */}
      <WindowTitleBar className="-mx-2 h-9" />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1" style={{ minHeight: CENTER_MIN_HEIGHT }}>
          <SnapSlot side="left" open={layout.left.open} size={layout.left.size}>
            {(w) => <SessionsSidebar width={w} />}
          </SnapSlot>
          {layout.left.open && (
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
            aria-label={t.timeline}
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-[var(--paper)] shadow-[0_8px_30px_-14px_rgb(0_0_0/0.3)] ring-1 ring-border"
            style={{ minWidth: CENTER_MIN_WIDTH }}
          >
            {/* 左右栏开关：对称贴在纸面左上角、右上角（圆角与纸面同心） */}
            <PanelToggle
              side="left"
              open={s.sessionsPanelOpen}
              label={s.sessionsPanelOpen ? t.hideSessions : t.showSessions}
              onToggle={() => s.setSessionsPanelOpen(!s.sessionsPanelOpen)}
            />
            <PanelToggle
              side="right"
              open={s.inspectorPanelOpen}
              label={s.inspectorPanelOpen ? t.hideInspector : t.showInspector}
              onToggle={() => s.setInspectorPanelOpen(!s.inspectorPanelOpen)}
            />
            <ChatPanel />
          </main>
          {layout.right.open && (
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
          <SnapSlot side="right" open={layout.right.open} size={layout.right.size}>
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

/** 吸附动画：略带回弹的缓动，像磁吸一样贴到中央纸面上 */
export const SNAP_MS = 320;
const SNAP_EASE = "cubic-bezier(0.34, 1.3, 0.64, 1)";

/**
 * 侧栏插槽：展开时宽度从 0 弹到目标宽度，面板内容贴着接缝一侧，看起来是从中央纸面背后滑出并吸附；
 * 收起时反向收回后再卸载。拖动调宽时不加过渡，跟手。
 */
function SnapSlot({
  side,
  open,
  size,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  size: number;
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
    }, SNAP_MS + 40);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [open]);

  if (!mounted) return null;
  const width = last.current;
  return (
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
}

function PanelToggle({
  side,
  open,
  label,
  onToggle,
}: {
  side: "left" | "right";
  open: boolean;
  label: string;
  onToggle: () => void;
}) {
  const Icon = side === "left" ? PanelLeft : PanelRight;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={open}
      onClick={onToggle}
      className={cn(
        "absolute top-1.5 z-10 grid size-7 place-items-center rounded-[10px] text-muted transition-colors hover:bg-hover hover:text-fg aria-pressed:text-fg",
        side === "left" ? "left-1.5" : "right-1.5",
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} />
    </button>
  );
}
