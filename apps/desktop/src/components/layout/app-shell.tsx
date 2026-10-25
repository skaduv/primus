"use client";

import { PanelLeft, PanelRight } from "lucide-react";
import { Separator, Toggle } from "radix-ui";
import { ChatPanel } from "@/features/chat/chat-panel";
import { strings } from "@/lib/strings";
import { useAppStore } from "@/stores/app-store";

// 主界面外壳：顶栏 · 左栏会话列表 · 中央时间线 · 右栏（变更/文件/计划）（第 16.2 节）。
// 目前是低保真骨架，各区域内容在后续功能中填充。
export function AppShell() {
  const sessionsOpen = useAppStore((s) => s.sessionsPanelOpen);
  const inspectorOpen = useAppStore((s) => s.inspectorPanelOpen);
  const setSessionsOpen = useAppStore((s) => s.setSessionsPanelOpen);
  const setInspectorOpen = useAppStore((s) => s.setInspectorPanelOpen);

  return (
    <div className="flex h-screen flex-col bg-surface text-fg">
      <header className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Toggle.Root
          pressed={sessionsOpen}
          onPressedChange={setSessionsOpen}
          aria-label={strings.layout.toggleSessions}
          className="rounded p-1.5 text-muted hover:bg-hover data-[state=on]:text-fg"
        >
          <PanelLeft aria-hidden size={16} />
        </Toggle.Root>
        <h1 className="flex-1 text-center text-sm font-medium">{strings.appName}</h1>
        <Toggle.Root
          pressed={inspectorOpen}
          onPressedChange={setInspectorOpen}
          aria-label={strings.layout.toggleInspector}
          className="rounded p-1.5 text-muted hover:bg-hover data-[state=on]:text-fg"
        >
          <PanelRight aria-hidden size={16} />
        </Toggle.Root>
      </header>
      <Separator.Root className="h-px bg-border" />
      <div className="flex min-h-0 flex-1">
        {sessionsOpen && (
          <>
            <nav aria-label={strings.layout.sessions} className="w-64 shrink-0 overflow-y-auto p-3">
              <p className="text-xs text-muted">{strings.layout.noSessions}</p>
            </nav>
            <Separator.Root orientation="vertical" className="w-px bg-border" />
          </>
        )}
        <main aria-label={strings.layout.timeline} className="flex min-w-0 flex-1 flex-col">
          <ChatPanel />
        </main>
        {inspectorOpen && (
          <>
            <Separator.Root orientation="vertical" className="w-px bg-border" />
            <aside
              aria-label={strings.layout.inspector}
              className="w-80 shrink-0 overflow-y-auto p-3"
            />
          </>
        )}
      </div>
    </div>
  );
}
