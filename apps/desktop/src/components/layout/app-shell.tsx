"use client";

import { Check, ChevronDown, PanelLeft, PanelRight, Sparkles } from "lucide-react";
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
import { glassButtonClass, toolbarButtonClass, useGlassStyle } from "./glass-panel";
import { InspectorPanel } from "./inspector-panel";
import { SessionsSidebar } from "./sessions-sidebar";

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
        <GlassPopoverItem icon={<Check />} label={t.mockModel} sublabel="mock" />
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
// 壁纸 → 浮动玻璃侧栏 / 检查器 → 中央实色"纸面"时间线 → 悬浮玻璃输入框。
export function AppShell() {
  const sessionsOpen = useAppStore((s) => s.sessionsPanelOpen);
  const inspectorOpen = useAppStore((s) => s.inspectorPanelOpen);
  const setSessionsOpen = useAppStore((s) => s.setSessionsPanelOpen);
  const setInspectorOpen = useAppStore((s) => s.setInspectorPanelOpen);

  return (
    <div className="flex h-screen min-h-[640px] min-w-[960px] gap-2 overflow-hidden p-2 text-fg">
      {sessionsOpen && <SessionsSidebar />}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <header className="flex h-10 shrink-0 items-center gap-2 px-1">
          <ToolbarToggle
            label={t.toggleSessions}
            pressed={sessionsOpen}
            onPressedChange={setSessionsOpen}
          >
            <PanelLeft aria-hidden size={16} />
          </ToolbarToggle>
          <div className="flex min-w-0 flex-1 flex-col items-center leading-tight">
            <h1 className="text-[13px] font-semibold">{strings.appName}</h1>
            <p className="truncate text-[11px] text-muted">{t.untitledSession}</p>
          </div>
          <ModelPicker />
          <ToolbarToggle
            label={t.toggleInspector}
            pressed={inspectorOpen}
            onPressedChange={setInspectorOpen}
          >
            <PanelRight aria-hidden size={16} />
          </ToolbarToggle>
        </header>
        <main
          aria-label={t.timeline}
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] bg-[var(--paper)] shadow-[0_8px_30px_-14px_rgb(0_0_0/0.3)] ring-1 ring-border"
        >
          <ChatPanel />
        </main>
      </div>
      {inspectorOpen && <InspectorPanel />}
    </div>
  );
}
