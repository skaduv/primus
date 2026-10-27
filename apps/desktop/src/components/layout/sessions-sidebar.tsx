"use client";

import { ChevronsUpDown, FolderOpen, MessageSquarePlus, Search, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { GlassButton } from "@/components/ui/glass-button";
import {
  GlassPopover,
  GlassPopoverContent,
  GlassPopoverItem,
  GlassPopoverTrigger,
} from "@/components/ui/glass-popover";
import {
  GlassTooltip,
  GlassTooltipContent,
  GlassTooltipTrigger,
} from "@/components/ui/glass-tooltip";
import { strings } from "@/lib/strings";
import { GlassPanel, glassButtonClass, toolbarButtonClass, useGlassStyle } from "./glass-panel";
import { seamBleedStyle, sidePanelSeamStyle, sideShellClass } from "./seam";

const t = strings.layout;

// 左栏（默认 232px，可拖动、可收起，第 16.2 节）：工作区切换 · 搜索 · 会话列表 · 设置入口。
// 低保真阶段只有空状态，会话索引在后续任务接入。宽度由 AppShell 按视口计算后传入。
export function SessionsSidebar({ width }: { width: number }) {
  const router = useRouter();
  const glass = useGlassStyle();

  return (
    <div className={sideShellClass} style={{ width, ...sidePanelSeamStyle("left") }}>
      <GlassPanel className="shrink-0 shadow-none" style={seamBleedStyle("left", width)}>
        <nav aria-label={t.sessions} className="flex h-full flex-col gap-3 p-3">
          <GlassPopover>
            <GlassPopoverTrigger asChild>
              <button
                type="button"
                aria-label={t.workspace}
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm font-medium hover:bg-hover"
              >
                <FolderOpen aria-hidden size={16} className="text-muted" />
                <span className="min-w-0 flex-1 truncate">{t.chooseWorkspace}</span>
                <ChevronsUpDown aria-hidden size={14} className="text-muted" />
              </button>
            </GlassPopoverTrigger>
            <GlassPopoverContent tint={0.75}>
              <GlassPopoverItem icon={<FolderOpen />} label={t.openFolder} />
            </GlassPopoverContent>
          </GlassPopover>

          <label className="flex h-8 items-center gap-2 rounded-full bg-hover px-3 text-sm">
            <Search aria-hidden size={14} className="text-muted" />
            <input
              type="search"
              placeholder={t.searchSessions}
              aria-label={t.searchSessions}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
            />
          </label>

          <GlassButton
            variant="capsule"
            size={34}
            {...glass}
            className={`w-full ${glassButtonClass}`}
          >
            <MessageSquarePlus aria-hidden size={16} />
            <span className="text-[13px]">{t.newSession}</span>
          </GlassButton>

          <div className="scroll-thin flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-y-auto px-2 text-center">
            <p className="text-sm text-muted">{t.noSessions}</p>
            <p className="text-xs text-muted/80">{t.noSessionsHint}</p>
          </div>

          <div className="flex items-center">
            <GlassTooltip>
              <GlassTooltipTrigger asChild>
                <GlassButton
                  size={32}
                  {...glass}
                  aria-label={t.settings}
                  className={toolbarButtonClass}
                  onClick={() => router.push("/settings/")}
                >
                  <Settings aria-hidden size={16} />
                </GlassButton>
              </GlassTooltipTrigger>
              <GlassTooltipContent side="right">{t.settings}</GlassTooltipContent>
            </GlassTooltip>
          </div>
        </nav>
      </GlassPanel>
    </div>
  );
}
