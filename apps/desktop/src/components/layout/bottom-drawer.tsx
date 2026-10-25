"use client";

import { ScrollText, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/glass-tabs";
import { strings } from "@/lib/strings";
import { GlassPanel } from "./glass-panel";

const t = strings.drawerTabs;

function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 px-6 text-center text-sm text-muted">
      <span className="text-muted/70 [&_svg]:size-5">{icon}</span>
      <p>{children}</p>
    </div>
  );
}

// 底部抽屉（可收起、可拖动高度，第 16.2 节）：终端 · 日志。终端在第 12.5 节、日志在第 19.1 节对应任务中实现。
export function BottomDrawer({ height }: { height: number }) {
  return (
    <GlassPanel className="shrink-0" style={{ height }}>
      <section aria-label={strings.layout.drawer} className="flex h-full min-h-0 flex-col p-2">
        <Tabs defaultValue="terminal" className="flex h-full min-h-0 flex-col gap-2">
          <TabsList className="self-start">
            <TabsTrigger value="terminal">{t.terminal}</TabsTrigger>
            <TabsTrigger value="logs">{t.logs}</TabsTrigger>
          </TabsList>
          <TabsContent
            value="terminal"
            className="flex min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <Empty icon={<SquareTerminal />}>{t.terminalEmpty}</Empty>
          </TabsContent>
          <TabsContent value="logs" className="flex min-h-0 flex-1 data-[state=inactive]:hidden">
            <Empty icon={<ScrollText />}>{t.logsEmpty}</Empty>
          </TabsContent>
        </Tabs>
      </section>
    </GlassPanel>
  );
}
