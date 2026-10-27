"use client";

import { ChatPanel } from "@/features/chat/chat-panel";
import { strings } from "@/lib/strings";
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
          {layout.left.open && (
            <>
              <SessionsSidebar width={layout.left.size} />
              <ResizeHandle
                orientation="vertical"
                label={t.resizeSessions}
                value={layout.left.size}
                min={layout.left.min}
                max={layout.left.max}
                direction={1}
                onResize={s.setSessionsPanelWidth}
                onReset={() => s.setSessionsPanelWidth(LEFT_PANEL.initial)}
              />
            </>
          )}
          <main
            aria-label={t.timeline}
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] bg-[var(--paper)] shadow-[0_8px_30px_-14px_rgb(0_0_0/0.3)] ring-1 ring-border"
            style={{ minWidth: CENTER_MIN_WIDTH }}
          >
            <ChatPanel />
          </main>
          {layout.right.open && (
            <>
              <ResizeHandle
                orientation="vertical"
                label={t.resizeInspector}
                value={layout.right.size}
                min={layout.right.min}
                max={layout.right.max}
                direction={-1}
                onResize={s.setInspectorPanelWidth}
                onReset={() => s.setInspectorPanelWidth(RIGHT_PANEL.initial)}
              />
              <InspectorPanel width={layout.right.size} />
            </>
          )}
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
