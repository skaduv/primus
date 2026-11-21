"use client";

import { useEffect, useState } from "react";
import { LogoAssemble } from "@/components/brand/logo";
import { Icon } from "@/components/icons";
import { type AppInfo, getPlatform } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { settingsButtonClass } from "./settings-section";
import { UpdateSettings } from "./update-settings";

const t = strings.settings.about;

export function AboutSettings() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let active = true;
    getPlatform()
      .then((p) => p.appInfo?.())
      .then((res) => {
        if (active && res) setInfo(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <section className="settings-card divide-y divide-black/[0.055] overflow-hidden rounded-2xl dark:divide-white/[0.06]">
        <div className="flex flex-col items-start gap-5 px-6 py-6 sm:flex-row sm:items-center">
          <div className="settings-brand-emblem grid size-18 shrink-0 place-items-center rounded-[20px]">
            <LogoAssemble size={48} className="text-fg" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="text-xl font-semibold tracking-tight text-fg">{t.productName}</h3>
              {info?.appVersion && (
                <span className="inline-flex items-center rounded-full bg-black/[0.045] px-2.5 py-0.5 font-mono text-2xs font-medium text-muted tabular-nums ring-1 ring-inset ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.08]">
                  v{info.appVersion}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              <strong className="font-semibold text-fg">{t.introduction}</strong>
              {t.description}
            </p>
          </div>
        </div>
        {info && (
          <div className="grid grid-cols-1 divide-y divide-black/[0.05] bg-black/[0.012] sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-white/[0.055] dark:bg-white/[0.015]">
            <div className="flex items-center justify-between gap-2 px-5 py-3 sm:flex-col sm:items-start sm:justify-center">
              <span className="flex items-center gap-1.5 text-2xs text-muted">
                <Icon name="cpu" size="xs" />
                {t.coreVersion}
              </span>
              <span className="font-mono text-xs font-medium text-fg tabular-nums">
                {info.coreVersion}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-3 sm:flex-col sm:items-start sm:justify-center">
              <span className="flex items-center gap-1.5 text-2xs text-muted">
                <Icon name="monitor" size="xs" />
                {t.runtime}
              </span>
              <span className="font-mono text-xs font-medium text-fg">
                {info.platform} · {info.runtime}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-3">
              <div className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-2xs text-muted">
                  <Icon name="folder" size="xs" />
                  {t.dataDir}
                </span>
                <p className="mt-0.5 truncate font-mono text-xs text-fg">{info.dataDir}</p>
              </div>
              <button
                type="button"
                className={settingsButtonClass}
                onClick={() => {
                  void getPlatform()
                    .then((p) => p.revealPath?.(info.dataDir))
                    .catch(() => {});
                }}
              >
                <Icon name="folder-open" size="xs" />
                {t.openDataDir}
              </button>
            </div>
          </div>
        )}
      </section>
      <UpdateSettings compact />
    </div>
  );
}
