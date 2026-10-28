"use client";

import { BarChart3, Puzzle, Search, Settings, SquarePen, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { GlassButton } from "@/components/ui/glass-button";
import {
  GlassPopover,
  GlassPopoverContent,
  GlassPopoverItem,
  GlassPopoverSeparator,
  GlassPopoverTrigger,
} from "@/components/ui/glass-popover";
import { strings } from "@/lib/strings";
import { GlassPanel, glassButtonClass, toolbarButtonClass, useGlassStyle } from "./glass-panel";
import { seamBleedStyle, sidePanelSeamStyle, sideShellClass } from "./seam";

const t = strings.layout;

// 左栏（默认 232px，可拖动、可收起，第 16.2 节）：新会话 · 搜索 · 会话列表 · 设置菜单。
// 工作区在中央输入框上方选择；会话索引在后续任务接入。宽度由 AppShell 按视口计算后传入。
export function SessionsSidebar({ width }: { width: number }) {
  const router = useRouter();
  const glass = useGlassStyle();

  return (
    <div className={sideShellClass} style={{ width, ...sidePanelSeamStyle("left") }}>
      <GlassPanel className="shrink-0 shadow-none" style={seamBleedStyle("left", width)}>
        <nav aria-label={t.sessions} className="flex h-full flex-col gap-3 p-3">
          <GlassButton
            variant="capsule"
            size={36}
            {...glass}
            className={`w-full ${glassButtonClass}`}
          >
            <SquarePen aria-hidden size={16} strokeWidth={2} />
            <span className="text-[13px] font-medium">{t.newSession}</span>
          </GlassButton>

          <label className="flex h-8 items-center gap-2 rounded-full bg-hover px-3 text-sm">
            <Search aria-hidden size={14} className="text-muted" />
            <input
              type="search"
              placeholder={t.searchSessions}
              aria-label={t.searchSessions}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
            />
          </label>

          {/* 会话列表（会话索引接入后填充） */}
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto" />

          {/* 设置入口：先展开菜单（账户 · 用量 · 能力中心 · 设置），选"设置"才进入设置页 */}
          <div className="flex items-center">
            <GlassPopover>
              <GlassPopoverTrigger asChild>
                <GlassButton
                  size={32}
                  {...glass}
                  aria-label={t.settings}
                  className={toolbarButtonClass}
                >
                  <Settings aria-hidden size={16} />
                </GlassButton>
              </GlassPopoverTrigger>
              <GlassPopoverContent side="top" sideOffset={8} tint={0.75} minWidth={168}>
                <GlassPopoverItem
                  icon={<UserRound />}
                  label={t.menuAccount}
                  sublabel={t.menuAccountHint}
                  disabled
                />
                <GlassPopoverItem
                  icon={<BarChart3 />}
                  label={t.menuUsage}
                  onSelect={() => router.push("/usage/")}
                />
                <GlassPopoverItem
                  icon={<Puzzle />}
                  label={t.menuCapabilities}
                  onSelect={() => router.push("/capabilities/")}
                />
                <GlassPopoverSeparator />
                <GlassPopoverItem
                  icon={<Settings />}
                  label={t.menuSettings}
                  onSelect={() => router.push("/settings/")}
                />
              </GlassPopoverContent>
            </GlassPopover>
          </div>
        </nav>
      </GlassPanel>
    </div>
  );
}
