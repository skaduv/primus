"use client";

import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "@/components/icons";
import { GlassPanel } from "@/components/layout/glass-panel";
import {
  centerSeamStyle,
  OUTER_RADIUS,
  SEAM_BLEED,
  sidePanelSeamStyle,
  sideShellClass,
} from "@/components/layout/seam";
import { WindowTitleBar } from "@/components/layout/window-controls";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/glass-tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { type ThemeMode, useAppearanceStore } from "@/stores/appearance-store";
import { useSettingsStore } from "@/stores/settings-store";
import { NotificationSettingsSection } from "../notifications/notification-settings";
import { AboutSettings } from "./about-settings";
import { AccountSettings } from "./account-models";
import { AdvancedSettings } from "./advanced-settings";
import { AgentSettings } from "./agent-settings";
import { ArchivedSettings } from "./archived-settings";
import { CapabilitySettings } from "./capability-settings";
import { Row, Section, SettingsAlert } from "./settings-section";
import { UsageSettings } from "./usage-settings";

const t = strings.settings;
export type SettingsGroup = keyof typeof t.groups;
const GROUPS = Object.keys(t.groups) as SettingsGroup[];
/** 左侧导航的自然视觉分组边界：在这些项上方留出极柔和的呼吸间隔 */
const NAV_SECTION_BREAKS = new Set<SettingsGroup>(["agent", "advanced"]);
const GROUP_ICONS = {
  general: "settings",
  account: "user",
  usage: "chart",
  agent: "thinking",
  archived: "archive",
  capabilities: "puzzle",
  advanced: "tuning",
  about: "info",
} satisfies Record<SettingsGroup, IconName>;

const THEME_ICONS: Record<ThemeMode, IconName> = {
  system: "monitor",
  light: "sun",
  dark: "moon",
};

function GeneralSettings() {
  const theme = useAppearanceStore((s) => s.theme);
  const setTheme = useAppearanceStore((s) => s.setTheme);
  const glassTint = useAppearanceStore((s) => s.glassTint);
  const setGlassTint = useAppearanceStore((s) => s.setGlassTint);
  const minimizeToTray = useSettingsStore((s) => s.minimizeToTray);
  const saving = useSettingsStore((s) => s.saving);
  const error = useSettingsStore((s) => s.error);
  const patchSettings = useSettingsStore((s) => s.patch);
  const themeLabel = useId();
  const glassPct = Math.round(glassTint * 100);

  return (
    <div className="flex flex-col gap-7">
      {error && <SettingsAlert message={error} />}
      <Section title={t.appearance}>
        <Row icon="sun" label={t.theme} hint={t.themeHint} labelId={themeLabel}>
          <Tabs value={theme} onValueChange={(v) => setTheme(v as ThemeMode)}>
            <TabsList aria-labelledby={themeLabel}>
              {(["system", "light", "dark"] as const).map((m) => (
                <TabsTrigger key={m} value={m} className="px-3 py-1.5 text-xs">
                  <Icon name={THEME_ICONS[m]} size="xs" />
                  {t.themes[m]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Row>
        <Row
          icon="layers"
          label={t.glass}
          hint={t.glassHint}
          badge={
            <span className="rounded-md bg-black/[0.045] px-1.5 py-0.5 text-2xs font-medium text-muted tabular-nums dark:bg-white/[0.07]">
              {glassPct}%
            </span>
          }
        >
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="select-none">{t.glassClear}</span>
            <Slider
              ariaLabel={t.glass}
              min={0}
              max={100}
              value={glassPct}
              onValueChange={(v) => setGlassTint(v / 100)}
            />
            <span className="select-none">{t.glassTinted}</span>
          </div>
        </Row>
        <Row icon="globe" label={t.language}>
          <span className="inline-flex h-8 items-center rounded-lg bg-black/[0.035] px-3 text-sm text-fg dark:bg-white/[0.06]">
            {t.languageValue}
          </span>
        </Row>
      </Section>
      <Section title={t.startup}>
        <Row icon="window" label={t.minimizeToTray} hint={t.minimizeToTrayHint}>
          <Switch
            ariaLabel={t.minimizeToTray}
            checked={minimizeToTray}
            disabled={saving}
            onCheckedChange={(checked) => void patchSettings({ minimizeToTray: checked })}
          />
        </Row>
      </Section>
      <NotificationSettingsSection />
    </div>
  );
}

interface PillRect {
  x: number;
  y: number;
  w: number;
  h: number;
  animate: boolean;
}

/** 带丝滑滑动高亮胶囊的设置侧栏分组列表（支持键盘上下/左右快速切换） */
function SettingsNavList({
  group,
  onSelect,
}: {
  group: SettingsGroup;
  onSelect: (g: SettingsGroup) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<Partial<Record<SettingsGroup, HTMLButtonElement | null>>>({});
  const groupRef = useRef(group);
  const mounted = useRef(false);
  const [pill, setPill] = useState<PillRect | null>(null);

  groupRef.current = group;

  const measure = useCallback((target: SettingsGroup, animate: boolean) => {
    const active = itemRefs.current[target];
    const list = listRef.current;
    if (!active || !list) return;
    const w = active.offsetWidth;
    const h = active.offsetHeight;
    // jsdom 中布局尺寸恒为 0，仅在真实浏览器布局存在时渲染滑块
    if (w === 0 && h === 0) return;
    setPill({
      x: active.offsetLeft,
      y: active.offsetTop,
      w,
      h,
      animate,
    });
  }, []);

  useLayoutEffect(() => {
    measure(group, mounted.current);
    mounted.current = true;
  }, [group, measure]);

  // 只在容器自身尺寸变化时无动画对齐，绝不在切换 group 时重建 observer 覆盖滑动过渡
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      measure(groupRef.current, false);
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [measure]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: SettingsGroup) => {
    const idx = GROUPS.indexOf(current);
    let nextIdx = -1;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIdx = (idx + 1) % GROUPS.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIdx = (idx - 1 + GROUPS.length) % GROUPS.length;
    } else if (event.key === "Home") {
      nextIdx = 0;
    } else if (event.key === "End") {
      nextIdx = GROUPS.length - 1;
    }
    if (nextIdx < 0) return;
    const next = GROUPS[nextIdx];
    if (!next) return;
    event.preventDefault();
    onSelect(next);
    itemRefs.current[next]?.focus();
  };

  return (
    <ul
      ref={listRef}
      className="scroll-thin relative isolate flex min-h-0 gap-1 overflow-x-auto pb-1 sm:flex-1 sm:flex-col sm:gap-0.5 sm:overflow-x-hidden sm:overflow-y-auto sm:pb-0"
    >
      {pill && (
        <div
          aria-hidden
          className="settings-nav-pill pointer-events-none absolute z-0 rounded-[10px]"
          style={{
            left: pill.x,
            top: pill.y,
            width: pill.w,
            height: pill.h,
            transition: pill.animate ? undefined : "none",
          }}
        />
      )}
      {GROUPS.map((g) => {
        const active = g === group;
        return (
          <li key={g} className="shrink-0">
            {NAV_SECTION_BREAKS.has(g) && (
              <div
                aria-hidden
                className="mx-2.5 my-2 hidden h-px bg-black/[0.06] sm:block dark:bg-white/[0.07]"
              />
            )}
            <button
              ref={(node) => {
                itemRefs.current[g] = node;
              }}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect(g)}
              onKeyDown={(e) => onKeyDown(e, g)}
              className={cn(
                "relative z-10 flex h-9 w-full cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-[10px] px-2.5 text-left text-sm transition-[color,background-color,transform] duration-150 active:scale-[0.985] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent/50 motion-reduce:transition-none",
                active
                  ? cn("font-medium text-fg", !pill && "bg-surface shadow-xs")
                  : "text-muted hover:bg-black/[0.035] hover:text-fg dark:hover:bg-white/[0.05]",
              )}
            >
              <Icon
                name={GROUP_ICONS[g]}
                size="sm"
                className={cn(
                  "shrink-0 transition-colors duration-150",
                  active ? "text-fg" : "text-muted",
                )}
              />
              <span className="truncate">{t.groups[g]}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// 设置（第 18 章）：与主界面同样的吸附样式——左侧导航与右侧内容是贴合的两块液态玻璃，接缝处直角 + 平滑凹口、无缝隙。
// 通用（外观、启动与窗口、通知与提示音，通知见 ADR 0023）、账号、用量、智能体、归档、能力中心（ADR 0017）、高级、关于共八个分组。

/** 地址中的 `?group=<分组>`（如侧栏菜单的“用量”打开 `/settings/?group=usage`）；无效值返回 null */
export function groupFromSearch(search: string): SettingsGroup | null {
  const g = new URLSearchParams(search).get("group");
  if (g === "models") return "agent";
  if (g === "update") return "about";
  return g && (GROUPS as string[]).includes(g) ? (g as SettingsGroup) : null;
}

export function SettingsView() {
  const router = useRouter();
  const advancedEnabled = useSettingsStore((s) => s.advancedEnabled);
  const loadSettings = useSettingsStore((s) => s.load);
  const patchSettings = useSettingsStore((s) => s.patch);
  const [group, setGroup] = useState<SettingsGroup>("general");
  const [scrolled, setScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 静态导出没有服务端：在客户端读查询参数选中分组（不用 useSearchParams，免去 Suspense 边界）
  useEffect(() => {
    const g = groupFromSearch(window.location.search);
    if (g) setGroup(g);
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const selectGroup = useCallback((next: SettingsGroup) => {
    setGroup(next);
    setScrolled(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  const contentWidthClass = "max-w-[740px]";

  return (
    <div className="flex h-screen w-screen flex-col gap-2 overflow-hidden px-2 pb-2 text-fg">
      {/* 主窗口没有系统标题栏：顶部细条可拖动窗口，窗口按钮贴在右上角（浏览器预览中只留上边距） */}
      <WindowTitleBar className="-mx-2 h-9" />
      <div className="flex min-h-0 flex-1 flex-col gap-2 sm:flex-row sm:gap-0">
        <div
          className={cn(sideShellClass, "min-w-0 max-sm:[--nr:0px]! max-sm:rounded-2xl! sm:w-56")}
          style={sidePanelSeamStyle("left")}
        >
          <GlassPanel
            className="w-full shrink-0 shadow-none sm:w-[calc(14rem+var(--settings-seam-bleed))] sm:rounded-r-none! sm:pr-(--settings-seam-bleed)"
            style={{ "--settings-seam-bleed": `${SEAM_BLEED}px` } as CSSProperties}
          >
            <nav
              aria-label={t.title}
              className="flex h-full min-h-0 flex-col gap-3 p-3 sm:gap-4 sm:pt-3.5"
            >
              <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-stretch sm:gap-3">
                <button
                  type="button"
                  aria-label={t.back}
                  onClick={() => router.push("/")}
                  className="group inline-flex h-8 w-fit cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted transition-[background-color,color,transform] duration-150 hover:bg-black/[0.045] hover:text-fg active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-accent/50 motion-reduce:transition-none dark:hover:bg-white/[0.06]"
                >
                  <Icon
                    name="chevron-left"
                    size="sm"
                    className="transition-transform duration-200 ease-out group-hover:-translate-x-0.5 motion-reduce:transition-none"
                  />
                  <span>{t.back}</span>
                </button>
                <h1 className="px-2.5 text-lg font-semibold tracking-tight text-fg">{t.title}</h1>
              </div>
              <SettingsNavList group={group} onSelect={selectGroup} />
            </nav>
          </GlassPanel>
        </div>
        <main
          aria-label={t.groups[group]}
          className="seam-mask relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-sm:[--nl:0px]! max-sm:rounded-2xl!"
          style={centerSeamStyle(true, false)}
        >
          {/* 与主界面一致：底层接缝由纸面裁掉，前景采用实色 ClearType 纸面保证阅读锐利清晰 */}
          <GlassPanel
            aria-hidden
            backdrop={false}
            radius={OUTER_RADIUS}
            className="-z-10 pointer-events-none absolute inset-y-0 shadow-none"
            style={{ position: "absolute", left: -SEAM_BLEED, right: 0 }}
          />
          <div
            aria-hidden
            className="-z-10 pointer-events-none absolute inset-0 bg-[var(--settings-canvas)]"
          />
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const next = e.currentTarget.scrollTop > 8;
              if (next !== scrolled) setScrolled(next);
            }}
            className="scroll-thin min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
          >
            <header
              className={cn(
                "sticky top-0 z-20 transition-[border-color,background-color] duration-200 motion-reduce:transition-none",
                scrolled
                  ? "settings-sticky-header border-b border-black/[0.06] dark:border-white/[0.07]"
                  : "border-b border-transparent bg-transparent",
              )}
            >
              <div
                className={cn(
                  "mx-auto flex w-full min-w-0 items-center justify-between gap-4 px-5 pt-6 pb-4 sm:px-8",
                  contentWidthClass,
                )}
              >
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold tracking-tight text-fg">
                    {t.groups[group]}
                  </h2>
                  <p className="mt-1 text-xs text-muted">{t.groupDescriptions[group]}</p>
                </div>
                {group === "advanced" && (
                  <div className="flex shrink-0 items-center gap-2.5">
                    <Switch
                      ariaLabel={strings.settings.ssh.enable}
                      checked={advancedEnabled}
                      onCheckedChange={(checked) =>
                        void patchSettings({ advancedEnabled: checked })
                      }
                    />
                  </div>
                )}
              </div>
            </header>
            <div
              key={group}
              className={cn(
                "settings-pane-in mx-auto flex w-full min-w-0 flex-col gap-7 px-5 pt-2 pb-12 sm:px-8",
                contentWidthClass,
              )}
            >
              {group === "general" ? (
                <GeneralSettings />
              ) : group === "account" ? (
                <AccountSettings />
              ) : group === "usage" ? (
                <UsageSettings autoLoad />
              ) : group === "agent" ? (
                <AgentSettings />
              ) : group === "archived" ? (
                <ArchivedSettings />
              ) : group === "capabilities" ? (
                <CapabilitySettings />
              ) : group === "advanced" ? (
                <AdvancedSettings enabled={advancedEnabled} />
              ) : (
                <AboutSettings />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
