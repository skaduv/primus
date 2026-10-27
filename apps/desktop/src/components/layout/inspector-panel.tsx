"use client";

import { FileDiff, FolderTree, ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/glass-tabs";
import { strings } from "@/lib/strings";
import { GlassPanel } from "./glass-panel";

const t = strings.inspectorTabs;

function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted">
      <span className="text-muted/70 [&_svg]:size-6">{icon}</span>
      <p>{children}</p>
    </div>
  );
}

// 右栏（可拖动、可收起，第 16.2 节）：变更 · 文件 · 计划。内容在第 14、15 章对应任务中实现。
export function InspectorPanel({ width }: { width: number }) {
  return (
    <GlassPanel className="shrink-0" style={{ width, borderRadius: "6px 16px 16px 6px" }}>
      <aside aria-label={strings.layout.inspector} className="flex h-full flex-col p-3">
        <Tabs defaultValue="changes" className="flex h-full flex-col">
          <TabsList className="self-center">
            <TabsTrigger value="changes">{t.changes}</TabsTrigger>
            <TabsTrigger value="files">{t.files}</TabsTrigger>
            <TabsTrigger value="plan">{t.plan}</TabsTrigger>
          </TabsList>
          <TabsContent value="changes" className="flex flex-1 data-[state=inactive]:hidden">
            <Empty icon={<FileDiff />}>{t.changesEmpty}</Empty>
          </TabsContent>
          <TabsContent value="files" className="flex flex-1 data-[state=inactive]:hidden">
            <Empty icon={<FolderTree />}>{t.filesEmpty}</Empty>
          </TabsContent>
          <TabsContent value="plan" className="flex flex-1 data-[state=inactive]:hidden">
            <Empty icon={<ListChecks />}>{t.planEmpty}</Empty>
          </TabsContent>
        </Tabs>
      </aside>
    </GlassPanel>
  );
}
