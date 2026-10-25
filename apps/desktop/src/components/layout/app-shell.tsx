"use client";

import { Check, ChevronDown, PanelBottom, PanelLeft, PanelRight, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { GlassButton } from "@/components/ui/glass-button";
import {
  GlassPopover,
  GlassPopoverContent,
  GlassPopoverItem,
  GlassPopoverSeparator,
  GlassPopoverTrigger,
} from "@/components/ui/glass-popover";
import {
  GlassTooltip,
  GlassTooltipContent,
  GlassTooltipTrigger,
} from "@/components/ui/glass-tooltip";
import { ChatPanel } from "@/features/chat/chat-panel";
import { strings } from "@/lib/strings";
import { useAppStore } from "@/stores/app-store";
import { BottomDrawer } from "./bottom-drawer";
import { glassButtonClass, toolbarButtonClass, useGlassStyle } from "./glass-panel";
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

const t = strings.layout;

function ToolbarToggle({
  label,
  pressed,
  onPressedChange,
  children,
}: {
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
}) {
  const glass = useGlassStyle();
  return (
    <GlassTooltip>
      <GlassTooltipTrigger asChild>
        <GlassButton
          size={32}
          {...glass}
          aria-label={label}
          aria-pressed={pressed}
          className={toolbarButtonClass}
          onClick={() => onPressedChange(!pressed)}
        >
          {children}
        </GlassButton>
      </GlassTooltipTrigger>
      <GlassTooltipContent side="bottom">{label}</GlassTooltipContent>
    </GlassTooltip>
  );
}

/** 顶栏中的模型与思考强度选择（低保真：只有 mock 模型） */
function ModelPicker() {
  const glass = useGlassStyle();
  const levels = t.thinkingLevels;
  return (
    <GlassPopover>
      <GlassPopoverTrigger asChild>
        <GlassButton
          variant="capsule"
          size={32}
          {...glass}
          aria-label={t.model}
          className={glassButtonClass}
        >
          <Sparkles aria-hidden size={14} className="text-accent" />
          <span className="text-[13px]">
            {t.mockModel} · {levels.medium}
          </span>
          <ChevronDown aria-hidden size={14} className="text-muted" />
        </GlassButton>
      </GlassPopoverTrigger>
      <GlassPopoverContent align="end" tint={0.75}>
        <GlassPopoverItem
          // 模型切换在接入 set_model 前只作展示
          disabled
          className="data-[disabled]:opacity-50"
          icon={<Check />}
          label={t.mockModel}
          sublabel="mock"
        />
        <GlassPopoverSeparator />
        {(["off", "low", "medium", "high"] as const).map((k) => (
          <GlassPopoverItem
            key={k}
            // 思考强度在接入 set_thinking_level 前只作展示
            disabled
            className="data-[disabled]:opacity-50"
            icon={k === "medium" ? <Check /> : <span />}
            label={`${t.thinkingLevel}：${levels[k]}`}
          />
        ))}
      </GlassPopoverContent>
    </GlassPopover>
  );
}

// 主界面外壳（第 16.2 节），macOS 27 Liquid Glass 风格：
// 壁纸 → 通栏顶栏 → 浮动玻璃左栏 / 右栏（可拖动、可收起）→ 中央实色"纸面"时间线 → 通栏底部抽屉（终端 · 日志）。
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
      className="flex h-screen flex-col gap-2 overflow-hidden p-2 text-fg"
      style={{ minWidth: MIN_WINDOW.width, minHeight: MIN_WINDOW.height }}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 px-1">
        <ToolbarToggle
          label={t.toggleSessions}
          pressed={s.sessionsPanelOpen}
          onPressedChange={s.setSessionsPanelOpen}
        >
          <PanelLeft aria-hidden size={16} />
        </ToolbarToggle>
        <div className="flex min-w-0 flex-1 flex-col items-center leading-tight">
          <h1 className="text-[13px] font-semibold">{strings.appName}</h1>
          <p className="truncate text-[11px] text-muted">{t.untitledSession}</p>
        </div>
        <ModelPicker />
        <ToolbarToggle
          label={t.toggleDrawer}
          pressed={s.bottomDrawerOpen}
          onPressedChange={s.setBottomDrawerOpen}
        >
          <PanelBottom aria-hidden size={16} />
        </ToolbarToggle>
        <ToolbarToggle
          label={t.toggleInspector}
          pressed={s.inspectorPanelOpen}
          onPressedChange={s.setInspectorPanelOpen}
        >
          <PanelRight aria-hidden size={16} />
        </ToolbarToggle>
      </header>

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
