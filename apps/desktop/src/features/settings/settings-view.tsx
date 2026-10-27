"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useState } from "react";
import { GlassPanel } from "@/components/layout/glass-panel";
import { WindowTitleBar } from "@/components/layout/window-controls";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassSlider } from "@/components/ui/glass-slider";
import { GlassSwitch } from "@/components/ui/glass-switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/glass-tabs";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { type ThemeMode, useAppearanceStore } from "@/stores/appearance-store";

const t = strings.settings;
export type SettingsGroup = keyof typeof t.groups;
const GROUPS = Object.keys(t.groups) as SettingsGroup[];

/** 设置中的一组卡片（macOS 系统设置的分组样式） */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-xs font-medium text-muted">{title}</h3>
      <div className="divide-y divide-border rounded-2xl bg-surface/80 ring-1 ring-border">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  labelId,
  children,
}: {
  label: string;
  hint?: string;
  labelId?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p id={labelId} className="text-sm">
          {label}
        </p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** 启动与通知开关的默认值（第 18 章），settings.toml 接入前只读 */
const PENDING_DEFAULTS = { reopen: true, tray: false, notify: true } as const;

function GeneralSettings() {
  const theme = useAppearanceStore((s) => s.theme);
  const setTheme = useAppearanceStore((s) => s.setTheme);
  const glassTint = useAppearanceStore((s) => s.glassTint);
  const setGlassTint = useAppearanceStore((s) => s.setGlassTint);
  // 启动与通知开关要写入 settings.toml（薄壳 settings_get/settings_set），接入前显示默认值并禁用
  const pending = PENDING_DEFAULTS;
  const themeLabel = useId();

  return (
    <div className="flex flex-col gap-6">
      <Section title={t.appearance}>
        <Row label={t.theme} labelId={themeLabel}>
          <Tabs value={theme} onValueChange={(v) => setTheme(v as ThemeMode)}>
            <TabsList aria-labelledby={themeLabel}>
              {(["system", "light", "dark"] as const).map((m) => (
                <TabsTrigger key={m} value={m}>
                  {t.themes[m]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Row>
        <Row label={t.glass} hint={t.glassHint}>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span>{t.glassClear}</span>
            <GlassSlider
              ariaLabel={t.glass}
              min={0}
              max={100}
              value={Math.round(glassTint * 100)}
              onValueChange={(v) => setGlassTint(v / 100)}
            />
            <span>{t.glassTinted}</span>
          </div>
        </Row>
        <Row label={t.language}>
          <span className="text-sm text-muted">{t.languageValue}</span>
        </Row>
      </Section>
      <Section title={t.startup}>
        <Row label={t.reopenWorkspace} hint={t.pendingSettingsHint}>
          <GlassSwitch ariaLabel={t.reopenWorkspace} checked={pending.reopen} disabled />
        </Row>
        <Row label={t.minimizeToTray} hint={t.pendingSettingsHint}>
          <GlassSwitch ariaLabel={t.minimizeToTray} checked={pending.tray} disabled />
        </Row>
      </Section>
      <Section title={t.notifications}>
        <Row label={t.notifyEnabled} hint={t.pendingSettingsHint}>
          <GlassSwitch ariaLabel={t.notifyEnabled} checked={pending.notify} disabled />
        </Row>
      </Section>
    </div>
  );
}

function Placeholder({ group }: { group: Exclude<SettingsGroup, "general"> }) {
  return (
    <Section title={t.groups[group]}>
      <div className="px-4 py-4 text-sm">
        <p className="text-muted">{t.comingSoon}</p>
        <p className="mt-1">{t.groupItems[group]}</p>
      </div>
    </Section>
  );
}

// 设置（第 18 章）：左侧玻璃导航列出全部分组，右侧实色纸面显示内容。
// 低保真阶段只实现"通用"中的外观、启动与通知，其余分组列出将提供的设置项。
export function SettingsView() {
  const router = useRouter();
  const [group, setGroup] = useState<SettingsGroup>("general");

  return (
    <div className="flex h-screen min-h-[640px] min-w-[960px] flex-col overflow-hidden px-2 pb-2 text-fg">
      {/* 主窗口没有系统标题栏：顶部细条可拖动窗口，窗口按钮贴在右上角（浏览器预览中只留上边距） */}
      <WindowTitleBar className="-mx-2 mb-1" />
      <div className="flex min-h-0 flex-1 gap-2">
        <GlassPanel className="w-[232px] shrink-0">
          <nav aria-label={t.title} className="flex h-full flex-col gap-3 p-3">
            <div className="flex items-center gap-2">
              <GlassButton size={30} aria-label={t.back} onClick={() => router.push("/")}>
                <ChevronLeft aria-hidden size={16} />
              </GlassButton>
              <h1 className="text-sm font-semibold">{t.title}</h1>
            </div>
            <ul className="scroll-thin flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {GROUPS.map((g) => (
                <li key={g}>
                  <button
                    type="button"
                    aria-current={g === group ? "page" : undefined}
                    onClick={() => setGroup(g)}
                    className={cn(
                      "w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-hover",
                      g === group && "bg-accent text-white hover:bg-accent",
                    )}
                  >
                    {t.groups[g]}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </GlassPanel>
        <main
          aria-label={t.groups[group]}
          className="scroll-thin min-w-0 flex-1 overflow-y-auto rounded-[22px] bg-[var(--paper)] ring-1 ring-border"
        >
          <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
            <h2 className="text-xl font-semibold tracking-tight">{t.groups[group]}</h2>
            {group === "general" ? <GeneralSettings /> : <Placeholder group={group} />}
          </div>
        </main>
      </div>
    </div>
  );
}
