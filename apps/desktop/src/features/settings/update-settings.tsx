"use client";

import { useEffect, useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/glass-tabs";
import { Switch } from "@/components/ui/switch";
import { useRestartUpdate } from "@/features/update/restart-update";
import { useUpdateStore } from "@/features/update/update-store";
import type { UpdateChannel, UpdateStatus } from "@/lib/platform";
import { strings } from "@/lib/strings";
import {
  Row,
  Section,
  SettingsAlert,
  settingsButtonClass,
  settingsPrimaryButtonClass,
} from "./settings-section";

const tu = strings.settings.update;
const CHANNELS: UpdateChannel[] = ["stable", "beta"];

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** 检查 / 下载进行中或检查结果的一行说明 */
export function updateStateText(status: UpdateStatus, checked: boolean): string | null {
  if (status.phase === "checking") return tu.checking;
  if (status.phase === "installing") return tu.installing;
  if (status.phase === "downloading") {
    const p = status.progress;
    if (p?.total) {
      const n = Math.min(100, Math.floor((p.downloaded / p.total) * 100));
      return tu.downloadingPercent.replace("{n}", String(n));
    }
    return tu.downloading;
  }
  // 最近一次检查失败的原因优先：已有待装版本时它仍显示在下方的“重启更新”行
  if (status.lastError) return tu.lastError.replace("{message}", status.lastError);
  if (status.pending) return tu.pendingReady.replace("{version}", status.pending.version);
  return checked ? tu.upToDate : null;
}

// 设置·更新（第 18 章、第 3.6 节）：当前版本、自动更新开关（默认开）、通道（稳定 / Beta）、立即检查。
// 下载完成后的重启提示由根布局中的 UpdatePrompt 显示。
export function UpdateSettings({
  installLabel = strings.update.restartNow,
  compact = false,
}: {
  installLabel?: string;
  compact?: boolean;
} = {}) {
  const status = useUpdateStore((s) => s.status);
  const loadError = useUpdateStore((s) => s.loadError);
  const start = useUpdateStore((s) => s.start);
  const check = useUpdateStore((s) => s.check);
  const setSettings = useUpdateStore((s) => s.setSettings);
  const [checked, setChecked] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const channelLabel = useId();
  const restartUpdate = useRestartUpdate();

  useEffect(() => {
    void start();
  }, [start]);

  if (!status) {
    return loadError ? (
      <SettingsAlert message={loadError || tu.loadFailed} />
    ) : (
      <div className="flex items-center gap-2 px-1 text-sm text-muted">
        <Icon name="loader" size="sm" className="session-spinner shrink-0" />
        <span>{tu.loading}</span>
      </div>
    );
  }

  const save = async (patch: Parameters<typeof setSettings>[0]) => {
    setSaving(true);
    setActionError(null);
    try {
      await setSettings(patch);
    } catch (e) {
      setActionError(errorText(e, tu.saveFailed));
    } finally {
      setSaving(false);
    }
  };
  const checkNow = async () => {
    setActionError(null);
    try {
      await check();
      setChecked(true);
    } catch (e) {
      setActionError(errorText(e, tu.checkFailed));
    }
  };
  const working = status.phase !== "idle";
  const stateText = updateStateText(status, checked);
  const downloadPercent =
    status.phase === "downloading" && status.progress?.total
      ? Math.min(100, Math.floor((status.progress.downloaded / status.progress.total) * 100))
      : null;

  return (
    <div className="flex flex-col gap-7">
      {actionError && <SettingsAlert message={actionError} />}
      <Section title={tu.title}>
        <Row label={tu.currentVersion} hint={status.available ? undefined : tu.unavailableHint}>
          <span className="inline-flex items-center rounded-md bg-black/[0.045] px-2 py-0.5 font-mono text-xs font-medium text-fg tabular-nums ring-1 ring-inset ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.08]">
            {status.currentVersion}
          </span>
        </Row>
        {/* 自动更新与更新通道在紧凑模式（关于页）也保留：应用内没有其他入口能改这两项 */}

        <Row label={tu.autoUpdate}>
          <Switch
            ariaLabel={tu.autoUpdate}
            checked={status.settings.autoUpdate}
            disabled={saving}
            onCheckedChange={(autoUpdate) => void save({ autoUpdate })}
          />
        </Row>
        <Row label={tu.channel} labelId={channelLabel}>
          <Tabs
            value={status.settings.channel}
            onValueChange={(v) => void save({ channel: v as UpdateChannel })}
          >
            <TabsList aria-labelledby={channelLabel}>
              {CHANNELS.map((c) => (
                <TabsTrigger key={c} value={c} disabled={saving}>
                  {tu.channels[c]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Row>

        <Row
          label={compact ? strings.settings.about.updateNow : tu.checkNow}
          hint={stateText ?? undefined}
        >
          <button
            type="button"
            onClick={() => (compact && status.pending ? restartUpdate.restart() : void checkNow())}
            disabled={
              working ||
              restartUpdate.working ||
              (!status.available && !(compact && status.pending))
            }
            className={compact && status.pending ? settingsPrimaryButtonClass : settingsButtonClass}
          >
            {status.phase === "checking" && (
              <Icon name="loader" size="xs" className="session-spinner shrink-0" />
            )}
            {status.phase === "checking"
              ? tu.checking
              : compact
                ? strings.settings.about.updateNow
                : tu.checkNow}
          </button>
        </Row>
        {downloadPercent !== null && (
          <div className="px-4 py-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-track">
              <div
                className="h-full rounded-full bg-fg transition-[width] duration-200 ease-out"
                style={{ width: `${downloadPercent}%` }}
              />
            </div>
          </div>
        )}
        {compact && restartUpdate.error && (
          <div className="p-3">
            <SettingsAlert message={restartUpdate.error} />
          </div>
        )}
        {!compact && status.pending && (
          <Row
            label={tu.pendingReady.replace("{version}", status.pending.version)}
            hint={restartUpdate.error ?? undefined}
          >
            <button
              type="button"
              onClick={restartUpdate.restart}
              disabled={restartUpdate.working}
              className={settingsPrimaryButtonClass}
            >
              {installLabel}
            </button>
          </Row>
        )}
      </Section>
      {restartUpdate.dialog}
    </div>
  );
}
