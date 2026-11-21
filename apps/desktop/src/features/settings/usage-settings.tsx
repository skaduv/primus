"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/glass-tabs";
import { useDelegatedTooltip } from "@/components/ui/tooltip";
import { useSessionsStore } from "@/features/sessions/sessions-store";
import { type AuthStatus, getPlatform, type SessionSummary } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";
import {
  Section,
  SettingsAlert,
  StatusPill,
  settingsButtonClass,
  settingsInputClass,
  settingsPrimaryButtonClass,
} from "./settings-section";

const t = strings.settings.usage;
const integer = new Intl.NumberFormat("zh-CN");
const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" });
const monthName = new Intl.DateTimeFormat("zh-CN", { month: "short" });
const metrics = ["daily", "weekly", "cumulative"] as const;
type Metric = (typeof metrics)[number];
const colors = ["bg-usage-0", "bg-usage-1", "bg-usage-2", "bg-usage-3", "bg-usage-4"] as const;
const statuses = { success: t.success, failed: t.failed, cancelled: t.cancelled };
const statusTones = { success: "success", failed: "danger", cancelled: "neutral" } as const;

interface Cost {
  amount: number;
  currency: string;
  estimated: boolean;
}

export interface ModelCall {
  id: string;
  timestamp: number;
  model: string;
  input: number | null;
  output: number | null;
  total: number | null;
  cost: Cost | null;
  status: keyof typeof statuses;
  session?: Pick<SessionSummary, "path" | "id" | "workspace">;
}

function dayKey(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

function formatNumber(value: number | null) {
  return value === null ? t.noData : integer.format(value);
}

function formatCost(cost: Cost) {
  const amount = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: cost.currency,
    currencyDisplay: "code",
    maximumFractionDigits: 6,
  }).format(cost.amount);
  return cost.estimated ? `${amount} · ${t.estimate}` : amount;
}

function getTotals(calls: readonly ModelCall[] | null) {
  // null 为没有数据来源（未知）；空数组为已知没有调用，Token 记为 0
  if (calls === null) return { requests: null, tokens: null, cost: t.noData, costAmount: null };
  if (calls.length === 0) return { requests: 0, tokens: 0, cost: t.noData, costAmount: null };
  let tokens = 0;
  let tokensKnown = true;
  let costKnown = true;
  const costs = new Map<string, Cost>();
  for (const call of calls) {
    if (call.total === null) tokensKnown = false;
    else tokens += call.total;
    if (call.cost === null) {
      costKnown = false;
      continue;
    }
    const previous = costs.get(call.cost.currency);
    costs.set(call.cost.currency, {
      currency: call.cost.currency,
      amount: (previous?.amount ?? 0) + call.cost.amount,
      estimated: Boolean(previous?.estimated || call.cost.estimated),
    });
  }
  return {
    requests: calls.length,
    tokens: tokensKnown ? tokens : null,
    cost: costKnown ? Array.from(costs.values(), formatCost).join(" + ") : t.noData,
    costAmount:
      costKnown && costs.size === 1 ? (costs.values().next().value?.amount ?? null) : null,
  };
}

export function UsageSettings({
  calls = null,
  completedAt = null,
  autoLoad = false,
}: {
  calls?: readonly ModelCall[] | null;
  completedAt?: readonly number[] | null;
  /** 在设置页打开时自动从平台读取本地会话的真实用量统计 */
  autoLoad?: boolean;
}) {
  const router = useRouter();
  const tip = useDelegatedTooltip();
  const [loadedCalls, setLoadedCalls] = useState<readonly ModelCall[] | null>(null);
  const [loadedCompletedAt, setLoadedCompletedAt] = useState<readonly number[] | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("daily");
  const swipe = useRef<{ pointerId: number; x: number; metric: Metric } | null>(null);
  const [date, setDate] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  /** 弹层内的临时日期；确认后才写入筛选 `date`，取消不改变已有筛选 */
  const [draftDate, setDraftDate] = useState("");
  const [account, setAccount] = useState<AuthStatus | null>(null);
  const [accountError, setAccountError] = useState(false);

  const loadRealStats = useCallback(async () => {
    setLoadingStats(true);
    setStatsError(null);
    try {
      const platform = await getPlatform();
      if (typeof platform.usageStats === "function") {
        const stats = await platform.usageStats();
        setLoadedCalls(stats.calls);
        setLoadedCompletedAt(stats.completedAt);
      }
    } catch {
      setStatsError(t.loadFailed);
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    if (!autoLoad || calls !== null) return;
    void loadRealStats();
  }, [autoLoad, calls, loadRealStats]);

  useEffect(() => {
    let active = true;
    getPlatform()
      .then((platform) => platform.authStatus())
      .then((status) => {
        if (active) setAccount(status);
      })
      .catch(() => {
        if (active) setAccountError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const [sessionError, setSessionError] = useState(false);
  const [today, setToday] = useState(() => new Date());

  // 跨过当地午夜或窗口重新激活时校正“今天”，时间窗口与日期上限随之更新
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      const now = new Date();
      setToday((previous) => (dayKey(previous) === dayKey(now) ? previous : now));
      clearTimeout(timer);
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(sync, nextMidnight.getTime() - now.getTime() + 1000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const inPeriod = (timestamp: number) => timestamp >= start.getTime() && timestamp < end.getTime();
  const effectiveCalls = calls ?? (autoLoad ? loadedCalls : null);
  const effectiveCompletedAt = completedAt ?? (autoLoad ? loadedCompletedAt : null);
  const periodCalls = effectiveCalls?.filter((call) => inPeriod(call.timestamp)) ?? null;
  const filtered = periodCalls
    ?.filter((call) => !date || dayKey(new Date(call.timestamp)) === date)
    .sort((first, second) => second.timestamp - first.timestamp);
  const totals = getTotals(periodCalls);
  const cards = [
    { label: t.cost, icon: "coins", value: totals.cost },
    { label: t.requests, icon: "bolt", value: formatNumber(totals.requests) },
    { label: t.tokens, icon: "cpu", value: formatNumber(totals.tokens) },
    {
      label: t.tasks,
      icon: "check-circle",
      value: formatNumber(effectiveCompletedAt?.filter(inPeriod).length ?? null),
    },
  ] as const;

  const byDay = new Map<string, ModelCall[]>();
  for (const call of periodCalls ?? []) {
    const key = dayKey(new Date(call.timestamp));
    const existing = byDay.get(key);
    if (existing) existing.push(call);
    else byDay.set(key, [call]);
  }

  const byWeek = new Map<string, ModelCall[]>();
  function weekStart(date: Date) {
    const monday = new Date(date);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
  }
  for (const call of periodCalls ?? []) {
    const key = dayKey(weekStart(new Date(call.timestamp)));
    const entries = byWeek.get(key);
    if (entries) entries.push(call);
    else byWeek.set(key, [call]);
  }
  const cumulative = new Map<string, number | null>();
  let runningTokens = 0;
  let tokensKnown = true;
  for (const cursor = new Date(start); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
    const key = dayKey(cursor);
    const daily = getTotals(byDay.get(key) ?? []);
    if (daily.requests && daily.tokens === null) tokensKnown = false;
    runningTokens += daily.tokens ?? 0;
    cumulative.set(key, periodCalls && tokensKnown ? runningTokens : null);
  }
  const months = Array.from({ length: 12 }, (_, offset) => {
    const month = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const leading = (month.getDay() + 6) % 7;
    const weeks = Math.ceil((leading + length) / 7);
    const days = Array.from({ length: weeks * 7 }, (_, index) => {
      const day = index - leading + 1;
      const date = new Date(month.getFullYear(), month.getMonth(), day);
      const key = dayKey(date);
      if (day < 1 || day > length) return { key, totals: null, value: null, range: "" };

      const daily = getTotals(byDay.get(key) ?? (periodCalls && date < end ? [] : null));
      const monday = weekStart(date);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      const weekly = getTotals(byWeek.get(dayKey(monday)) ?? (periodCalls ? [] : null));
      const value =
        date >= end
          ? null
          : metric === "daily"
            ? daily.tokens
            : metric === "weekly"
              ? weekly.tokens
              : (cumulative.get(key) ?? null);
      const range =
        metric === "weekly"
          ? `${dayKey(monday < start ? start : monday)} — ${dayKey(sunday >= end ? today : sunday)}`
          : metric === "cumulative"
            ? `${dayKey(start)} — ${key}`
            : key;
      return { key, totals: daily, value, range };
    });
    return { key: dayKey(month), name: monthName.format(month), weeks, days };
  });
  const maximum = Math.max(0, ...months.flatMap(({ days }) => days.map(({ value }) => value ?? 0)));

  useEffect(() => {
    if (!calendarOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setCalendarOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCalendarOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [calendarOpen]);

  function openSession(session: NonNullable<ModelCall["session"]>) {
    if (useSessionsStore.getState().openSession(session)) router.push("/");
    else setSessionError(true);
  }

  const accountLabel = accountError
    ? strings.settings.account.loadFailed
    : !account
      ? strings.settings.account.loading
      : account.loggedIn
        ? account.account?.name || strings.settings.account.notProvided
        : strings.settings.account.notSignedIn;

  return (
    <div className="flex flex-col gap-6" {...tip.handlers}>
      {statsError && <SettingsAlert message={statsError} />}
      <div className="settings-card flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            role="img"
            aria-label={strings.settings.account.avatar}
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full ring-1 ring-inset",
              account?.loggedIn
                ? "bg-fg/[0.08] text-fg ring-black/[0.08] dark:bg-white/[0.12] dark:ring-white/[0.12]"
                : "bg-black/[0.04] text-muted ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.08]",
            )}
          >
            <Icon name="user" size="md" />
          </span>
          <p className="truncate text-sm font-medium text-fg">{accountLabel}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-black/[0.045] px-2.5 py-0.5 text-2xs font-medium text-muted dark:bg-white/[0.07]">
            {t.period}
          </span>
          {autoLoad && (
            <button
              type="button"
              disabled={loadingStats}
              onClick={() => void loadRealStats()}
              className={settingsButtonClass}
            >
              <Icon
                name={loadingStats ? "loader" : "refresh"}
                size="xs"
                className={loadingStats ? "session-spinner" : undefined}
              />
              {loadingStats ? t.refreshing : t.refresh}
            </button>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {cards.map(({ label, icon, value }) => (
          <div
            key={label}
            className="settings-card min-w-0 rounded-2xl px-3.5 py-3 transition-colors duration-150 hover:bg-black/[0.03] dark:hover:bg-white/[0.045]"
          >
            <dt className="flex items-center gap-1.5 text-xs text-muted">
              <Icon name={icon} size="sm" className="shrink-0" />
              {label}
            </dt>
            <dd className="mt-2 break-words text-lg font-semibold tracking-tight text-fg tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <section
        aria-labelledby="usage-heatmap-heading"
        className="settings-card w-full space-y-3.5 rounded-2xl p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="usage-heatmap-heading" className="text-sm font-semibold text-fg">
            {t.heatmap}
          </h3>
          <Tabs
            value={metric}
            onValueChange={(value) => setMetric(value as Metric)}
            className="ml-auto"
          >
            <TabsList
              aria-label={t.metric}
              className="touch-pan-y select-none p-[2px]"
              onPointerDown={(event) => {
                if (event.button === 0)
                  swipe.current = { pointerId: event.pointerId, x: event.clientX, metric };
              }}
              onPointerCancel={() => {
                swipe.current = null;
              }}
              onPointerUp={(event) => {
                const start = swipe.current;
                swipe.current = null;
                if (!start || start.pointerId !== event.pointerId) return;
                const distance = event.clientX - start.x;
                if (Math.abs(distance) < 16) return;
                const next = metrics[metrics.indexOf(start.metric) + Math.sign(distance)];
                if (next) setMetric(next);
              }}
            >
              {metrics.map((choice) => (
                <TabsTrigger key={choice} value={choice} className="px-2.5 py-1 text-xs">
                  {t.metrics[choice]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 gap-[3px]">
            {months.map(({ key, name, weeks, days }) => (
              <div key={key} className="min-w-0" style={{ flex: `${weeks} 1 ${weeks - 1}px` }}>
                <h4 data-tooltip={name} className="mb-1 h-4 truncate text-2xs text-muted">
                  {name}
                </h4>
                <div
                  className="grid grid-flow-col grid-rows-7 gap-[2px]"
                  style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}
                >
                  {days.map((day) => {
                    if (!day.totals)
                      return (
                        <span
                          key={day.key}
                          aria-hidden
                          className="aspect-square rounded-[2.5px] bg-black/[0.03] dark:bg-white/[0.03]"
                        />
                      );
                    const value = day.value ?? 0;
                    const level = value > 0 ? Math.ceil((value / maximum) * 4) : 0;
                    const detail = [
                      day.key,
                      `${t.metrics[metric]}：${day.range}`,
                      `${t.tokenMetric}：${formatNumber(day.value)}`,
                      `${t.requestMetric}：${formatNumber(day.totals.requests)}`,
                      `${t.rowCost}：${day.totals.cost}`,
                    ].join("\n");
                    return (
                      <span
                        key={day.key}
                        role="img"
                        aria-label={detail}
                        data-tooltip={detail}
                        className={`aspect-square rounded-[2.5px] transition-[transform,box-shadow] duration-100 hover:ring-1 hover:ring-fg/35 ${colors[level]}`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <ul className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-2xs text-muted">
          {t.levels.map((label, index) => (
            <li key={label} className="flex items-center gap-1.5">
              <span aria-hidden className={`size-2.5 rounded-[2.5px] ${colors[index]}`} />
              {label}
            </li>
          ))}
        </ul>
      </section>
      <Section title={t.calls} contentClassName="overflow-visible">
        <div className="scroll-thin overflow-x-auto rounded-2xl">
          <table aria-label={t.calls} className="w-full min-w-0 table-fixed text-left text-xs">
            <colgroup>
              {[19, 24, 10, 10, 11, 14, 12].map((width, index) => (
                <col
                  key={[t.time, t.model, t.input, t.output, t.total, t.rowCost, t.status][index]}
                  style={{ width: `${width}%` }}
                />
              ))}
            </colgroup>
            <thead className="bg-black/[0.02] text-muted dark:bg-white/[0.025]">
              <tr>
                {[t.time, t.model, t.input, t.output, t.total, t.rowCost, t.status].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className={cn(
                      "break-words px-3 py-2.5 font-medium",
                      (label === t.input || label === t.output || label === t.total) &&
                        "text-right",
                    )}
                  >
                    {label === t.time ? (
                      <div ref={calendarRef} className="relative inline-block">
                        <button
                          type="button"
                          aria-expanded={calendarOpen}
                          onClick={() => {
                            if (!calendarOpen) setDraftDate(date || dayKey(today));
                            setCalendarOpen(!calendarOpen);
                          }}
                          className={cn(
                            "inline-flex cursor-pointer items-center gap-1 rounded-md px-1 -mx-1 py-0.5 text-left transition-colors hover:bg-hover hover:text-fg",
                            date && "text-fg",
                          )}
                        >
                          <Icon name="calendar" size="xs" className="text-muted" />
                          {label}
                          <Icon
                            name="chevron-down"
                            size="xs"
                            className={cn(
                              "transition-transform duration-150 motion-reduce:transition-none",
                              calendarOpen && "rotate-180",
                            )}
                          />
                        </button>
                        {calendarOpen && (
                          <div
                            role="dialog"
                            aria-label={t.date}
                            className="settings-popover-in absolute left-0 top-full z-30 mt-2 w-56 rounded-xl bg-surface p-3 shadow-[0_8px_28px_-6px_rgb(0_0_0/0.22)] ring-1 ring-black/[0.08] dark:shadow-[0_12px_32px_-6px_rgb(0_0_0/0.6)] dark:ring-white/[0.12]"
                            onKeyDown={(event) => {
                              if (event.key === "Escape") setCalendarOpen(false);
                            }}
                          >
                            <input
                              type="date"
                              aria-label={t.date}
                              className={settingsInputClass}
                              min={dayKey(start)}
                              max={dayKey(today)}
                              value={draftDate}
                              onChange={(event) => setDraftDate(event.target.value)}
                            />
                            <div className="mt-2.5 flex justify-end gap-2">
                              <button
                                type="button"
                                className={settingsButtonClass}
                                onClick={() => {
                                  setDate("");
                                  setCalendarOpen(false);
                                }}
                              >
                                {t.clearDate}
                              </button>
                              <button
                                type="button"
                                disabled={!draftDate}
                                className={settingsPrimaryButtonClass}
                                onClick={() => {
                                  setDate(draftDate);
                                  setCalendarOpen(false);
                                }}
                              >
                                {t.applyDate}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.05] border-t border-black/[0.06] tabular-nums dark:divide-white/[0.055] dark:border-white/[0.07]">
              {!filtered?.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">
                    {periodCalls?.length ? t.noMatchingCalls : t.noData}
                  </td>
                </tr>
              )}
              {filtered?.map((call) => {
                const session = call.session;
                return (
                  <tr
                    key={call.id}
                    className="transition-colors duration-150 hover:bg-black/[0.02] dark:hover:bg-white/[0.025]"
                  >
                    <td className="break-words px-3 py-2.5 text-muted">
                      {session ? (
                        <button
                          type="button"
                          className="cursor-pointer font-medium text-fg underline decoration-border underline-offset-2 transition-colors hover:decoration-fg"
                          onClick={() => openSession(session)}
                        >
                          {dateTime.format(call.timestamp)}
                        </button>
                      ) : (
                        dateTime.format(call.timestamp)
                      )}
                    </td>
                    <td
                      className="truncate px-3 py-2.5 font-medium text-fg"
                      data-tooltip={call.model}
                    >
                      {call.model}
                    </td>
                    <td className="break-words px-3 py-2.5 text-right text-muted">
                      {formatNumber(call.input)}
                    </td>
                    <td className="break-words px-3 py-2.5 text-right text-muted">
                      {formatNumber(call.output)}
                    </td>
                    <td className="break-words px-3 py-2.5 text-right font-medium text-fg">
                      {formatNumber(call.total)}
                    </td>
                    <td className="break-words px-3 py-2.5 text-muted">
                      {call.cost ? formatCost(call.cost) : t.noData}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill tone={statusTones[call.status]} className="px-2 py-0.5 text-2xs">
                        {statuses[call.status]}
                      </StatusPill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sessionError && (
          <div className="p-3">
            <SettingsAlert message={t.sessionUnavailable} />
          </div>
        )}
      </Section>
      {tip.ui}
    </div>
  );
}
