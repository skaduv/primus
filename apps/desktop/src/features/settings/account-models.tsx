"use client";

import { RadioGroup } from "radix-ui";
import { useEffect, useId, useState } from "react";
import { Icon } from "@/components/icons";
import { type AuthStatus, getPlatform, type ModelSummary, type ModelsInfo } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { useModelsInfo } from "@/lib/use-models";
import { cn } from "@/lib/utils";
import { type AgentModelMode, useSettingsStore } from "@/stores/settings-store";
import {
  Row,
  Section,
  SettingsAlert,
  SettingsSelect,
  StatusPill,
  settingsButtonClass,
  settingsDangerButtonClass,
  settingsPrimaryButtonClass,
} from "./settings-section";

const ta = strings.settings.account;
const tm = strings.settings.models;
const agent = strings.settings.agent;

/** 令牌数的简写：1,000,000 → 1M，128,000 → 128K */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function Badge({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-black/[0.045] px-1.5 py-0.5 text-2xs font-medium text-muted tabular-nums ring-1 ring-inset ring-black/[0.04] dark:bg-white/[0.07] dark:ring-white/[0.06]">
      {children}
    </span>
  );
}

// 设置·账号（第 9.7 节）：账号服务接入前显示未登录与说明，登录 / 登出按钮禁用（loginAvailable 为 false）。
export function AccountSettings() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPlatform()
      .then((p) => p.authStatus())
      .then((s) => !cancelled && setStatus(s))
      .catch((e: unknown) => !cancelled && setError(errorText(e, ta.loadFailed)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status && error) return <SettingsAlert message={error} />;
  if (!status)
    return (
      <div className="flex items-center gap-2 px-1 text-sm text-muted">
        <Icon name="loader" size="sm" className="session-spinner shrink-0" />
        <span>{ta.loading}</span>
      </div>
    );

  const account = status.loggedIn ? status.account : null;
  const canLogout = status.loggedIn && status.loginAvailable;

  async function changeLogin(action: "login" | "logout") {
    setBusy(true);
    setError(null);
    try {
      const platform = await getPlatform();
      if (action === "login") {
        setStatus(await platform.authLogin());
      } else {
        await platform.authLogout();
        // 登出已成功：先落到未登录，状态刷新失败不回退旧账户、也不报登出失败
        setStatus((prev) => ({
          loggedIn: false,
          account: null,
          loginAvailable: prev?.loginAvailable ?? false,
        }));
        try {
          setStatus(await platform.authStatus());
        } catch {
          // 保留已登出状态
        }
      }
    } catch (failure) {
      setError(errorText(failure, action === "login" ? ta.loginFailed : ta.logoutFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <Section title={ta.title} description={ta.localModeNote}>
        <Row label={ta.avatar} hint={ta.notProvided}>
          <span
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-full ring-1 ring-inset transition-colors",
              status.loggedIn
                ? "bg-fg/[0.08] text-fg ring-black/[0.08] dark:bg-white/[0.12] dark:ring-white/[0.12]"
                : "bg-black/[0.04] text-muted ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.08]",
            )}
          >
            <Icon name="user" size="lg" />
          </span>
        </Row>
        <Row label={ta.name}>
          <span
            className={cn(
              "min-w-0 break-all text-right text-sm",
              account?.name ? "font-medium text-fg" : "text-muted",
            )}
          >
            {account?.name || ta.notProvided}
          </span>
        </Row>
        <Row label={ta.email}>
          <span className="text-sm text-muted">{ta.notProvided}</span>
        </Row>
        <Row label={ta.status}>
          <StatusPill role="status" tone={status.loggedIn ? "success" : "neutral"}>
            {status.loggedIn ? ta.signedIn : ta.notSignedIn}
          </StatusPill>
        </Row>
      </Section>
      <Section title={ta.actions}>
        {!status.loggedIn && (
          <Row label={ta.login} hint={!status.loginAvailable ? ta.loginUnavailable : undefined}>
            <button
              type="button"
              disabled={busy || !status.loginAvailable}
              onClick={() => void changeLogin("login")}
              className={settingsPrimaryButtonClass}
            >
              <Icon name="log-in" size="xs" />
              {ta.login}
            </button>
          </Row>
        )}
        <Row label={ta.switchAccount} hint={ta.loginUnavailable}>
          <button type="button" disabled className={settingsButtonClass}>
            {ta.switchAccount}
          </button>
        </Row>
        <Row label={ta.logout} hint={!canLogout ? ta.loginUnavailable : undefined}>
          <button
            type="button"
            disabled={busy || !canLogout}
            onClick={() => void changeLogin("logout")}
            className={settingsDangerButtonClass}
          >
            <Icon name="log-out" size="xs" />
            {ta.logout}
          </button>
        </Row>
      </Section>
      {error && <SettingsAlert message={error} />}
    </div>
  );
}

function ModelDetail({ model }: { model: ModelSummary }) {
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <Badge>{tm.protocols[model.api] ?? model.api}</Badge>
      <Badge>{`${tm.context} ${formatTokens(model.contextWindow)}`}</Badge>
      <Badge>{`${tm.maxOutput} ${formatTokens(model.maxTokens)}`}</Badge>
      {model.image && <Badge>{tm.image}</Badge>}
      {model.reasoning && <Badge>{tm.reasoning}</Badge>}
    </span>
  );
}

// 设置·模型（第 9.5 节）：从已启用渠道的模型中改选默认模型（新会话生效）；显示压缩与标题使用的模型与配置错误。
// 随 models_watch 更新：添加、修改渠道或后台获取到模型列表后立即刷新。
export function ModelSettings() {
  const { info, error: loadError, update } = useModelsInfo();
  const modelMode = useSettingsStore((s) => s.agentModelMode);
  const patchSettings = useSettingsStore((s) => s.patch);
  const error = loadError ? errorText(loadError, tm.loadFailed) : null;
  // 改选与刷新的失败分别用各自的标题
  const [actionError, setActionError] = useState<{ title: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const labelId = useId();

  const run = async (action: () => Promise<ModelsInfo>, title: string) => {
    setBusy(true);
    setActionError(null);
    try {
      update(await action());
    } catch (e) {
      setActionError({ title, message: errorText(e, title) });
    } finally {
      setBusy(false);
    }
  };

  const choose = (key: string) =>
    run(async () => (await getPlatform()).modelsSetDefault(key), tm.saveFailed);
  const refresh = () => run(async () => (await getPlatform()).modelsRefresh(), tm.refreshFailed);

  if (!info) {
    return error ? (
      <SettingsAlert message={error} />
    ) : (
      <div className="flex items-center gap-2 px-1 text-sm text-muted">
        <Icon name="loader" size="sm" className="session-spinner shrink-0" />
        <span>{tm.loading}</span>
      </div>
    );
  }

  const nameOf = (key: string | null) => info.models.find((m) => m.key === key)?.name ?? key ?? "—";

  return (
    <div className="flex flex-col gap-7">
      {info.error && <SettingsAlert title={tm.configError} message={info.error} />}
      {actionError && <SettingsAlert title={actionError.title} message={actionError.message} />}
      <Section title={tm.defaultModel}>
        <Row label={agent.modelMode} hint={agent.modelHint}>
          <SettingsSelect
            aria-label={agent.modelMode}
            value={modelMode}
            onChange={(event) => {
              const next = event.currentTarget.value as AgentModelMode;
              if (next === "automatic" || next === "manual") {
                void patchSettings({ agentModelMode: next });
              }
            }}
          >
            <option value="automatic">{agent.modelAutomatic}</option>
            <option value="manual">{agent.modelManual}</option>
          </SettingsSelect>
        </Row>
        <p id={labelId} className="sr-only">
          {tm.defaultModel}
        </p>
        <RadioGroup.Root
          aria-labelledby={labelId}
          value={info.defaultModel ?? undefined}
          onValueChange={choose}
          disabled={busy}
          className="flex flex-col divide-y divide-black/[0.045] dark:divide-white/[0.05]"
        >
          {info.models.length === 0 && !info.error && (
            <p className="px-4 py-4 text-xs text-muted">{tm.noModels}</p>
          )}
          {info.models.map((model) => (
            <RadioGroup.Item
              key={model.key}
              value={model.key}
              aria-label={model.name}
              className={cn(
                "group flex cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-black/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/45 data-[state=checked]:bg-black/[0.028] dark:hover:bg-white/[0.03] dark:data-[state=checked]:bg-white/[0.04]",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-black/[0.18] transition-colors group-data-[state=checked]:ring-select dark:ring-white/[0.22] dark:group-data-[state=checked]:ring-select">
                <RadioGroup.Indicator className="size-2 rounded-full bg-select" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{model.name}</span>
                <ModelDetail model={model} />
              </span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </Section>
      <Section title={tm.background}>
        <Row label={nameOf(info.compactionModel)}>
          <button type="button" onClick={refresh} disabled={busy} className={settingsButtonClass}>
            <Icon
              name={busy ? "loader" : "refresh"}
              size="xs"
              className={busy ? "session-spinner" : undefined}
            />
            {busy ? tm.refreshing : tm.refresh}
          </button>
        </Row>
      </Section>
    </div>
  );
}
