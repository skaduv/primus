"use client";

import { useEffect, useId, useState } from "react";
import { Icon } from "@/components/icons";
import {
  GlassDialog,
  GlassDialogClose,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/ui/glass-dialog";
import { type AppInfo, getPlatform } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { type SshServerConfig, useSettingsStore } from "@/stores/settings-store";
import { Badge } from "./account-models";
import {
  Row,
  Section,
  StatusPill,
  settingsButtonClass,
  settingsDangerButtonClass,
  settingsInputClass,
  settingsPrimaryButtonClass,
} from "./settings-section";

const t = strings.settings.ssh;
const buttonClass = settingsButtonClass;
const fieldClass = settingsInputClass;
const empty = { name: "", address: "", port: "22", username: "" };

const DEFAULT_SERVERS: SshServerConfig[] = [
  {
    id: "teaching",
    name: t.teaching,
    address: "teaching.example.com",
    port: "22",
    username: "teacher",
    example: true,
  },
  {
    id: "resources",
    name: t.resources,
    address: "resources.example.com",
    port: "22",
    username: "teacher",
    example: true,
  },
];

export function AdvancedSettings({ enabled }: { enabled: boolean }) {
  const prefix = useId();
  const storedServers = useSettingsStore((s) => s.sshServers);
  const patchSettings = useSettingsStore((s) => s.patch);
  const servers = storedServers ?? DEFAULT_SERVERS;
  const [selected, setSelected] = useState<SshServerConfig | "new" | null>(null);
  const [draft, setDraft] = useState(empty);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const creating = selected === "new";

  useEffect(() => {
    let active = true;
    getPlatform()
      .then((p) => p.appInfo?.())
      .then((info) => {
        if (active && info) setAppInfo(info);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setSelected(null);
      setPassword("");
      setNotice("");
    }
  }, [enabled]);

  function close() {
    setSelected(null);
    setPassword("");
    setNotice("");
  }
  function open(server: SshServerConfig | "new") {
    setDraft(server === "new" ? empty : server);
    setPassword("");
    setNotice("");
    setSelected(server);
  }

  function saveServers(next: SshServerConfig[]) {
    void patchSettings({ sshServers: next });
  }

  function copySshCommand() {
    const user = draft.username.trim() || "user";
    const host = draft.address.trim() || "localhost";
    const port = draft.port.trim() || "22";
    const cmd = port === "22" ? `ssh ${user}@${host}` : `ssh -p ${port} ${user}@${host}`;
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      setNotice(t.copyFailed);
      return;
    }
    clipboard.writeText(cmd).then(
      () => setNotice(t.copiedCommand.replace("{cmd}", cmd)),
      () => setNotice(t.copyFailed),
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <fieldset
        disabled={!enabled}
        aria-label={t.title}
        className={cn(
          "min-w-0 transition-[opacity,filter] duration-200 motion-reduce:transition-none",
          !enabled && "opacity-50 grayscale",
        )}
      >
        <Section
          title={t.title}
          description={t.hint}
          action={
            <button type="button" className={buttonClass} onClick={() => open("new")}>
              <Icon name="plus" size="sm" />
              {t.create}
            </button>
          }
        >
          {servers.map((server) => (
            <button
              key={server.id}
              type="button"
              className="group flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left transition-colors duration-150 enabled:hover:bg-black/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/45 disabled:cursor-not-allowed dark:enabled:hover:bg-white/[0.03]"
              onClick={() => open(server)}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-black/[0.045] text-muted ring-1 ring-inset ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.07]">
                <Icon name="server" size="sm" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                  {server.name}
                  {server.example && <Badge>{t.example}</Badge>}
                </span>
                <span className="mt-0.5 block font-mono text-xs break-all text-muted">
                  {server.address}:{server.port}
                </span>
              </span>
              <StatusPill tone="neutral">{t.disconnected}</StatusPill>
              <Icon
                name="chevron-right"
                size="sm"
                className="shrink-0 text-muted transition-transform duration-150 group-enabled:group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </button>
          ))}
        </Section>
      </fieldset>

      {appInfo && (
        <Section title={t.runtimeTitle}>
          <Row icon="folder" label={t.dataDir} hint={appInfo.dataDir}>
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                void getPlatform()
                  .then((p) => p.revealPath?.(appInfo.dataDir))
                  .catch(() => {});
              }}
            >
              <Icon name="folder-open" size="xs" />
              {t.openDataDir}
            </button>
          </Row>
          <Row icon="cpu" label={t.coreVersion}>
            <span className="inline-flex items-center rounded-md bg-black/[0.045] px-2 py-0.5 font-mono text-xs font-medium text-fg tabular-nums dark:bg-white/[0.07]">
              {appInfo.coreVersion}
            </span>
          </Row>
          <Row icon="monitor" label={t.platform}>
            <span className="inline-flex items-center rounded-md bg-black/[0.045] px-2 py-0.5 font-mono text-xs text-muted dark:bg-white/[0.07]">
              {appInfo.platform} · {appInfo.runtime}
            </span>
          </Row>
        </Section>
      )}

      <GlassDialog
        open={enabled && selected !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <GlassDialogContent>
          <GlassDialogTitle>{creating ? t.create : draft.name}</GlassDialogTitle>
          <GlassDialogDescription>{t.dialogHint}</GlassDialogDescription>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!enabled) return;
              if (creating) {
                saveServers([
                  ...servers,
                  {
                    ...draft,
                    name: draft.name.trim(),
                    address: draft.address.trim(),
                    username: draft.username.trim(),
                    id: crypto.randomUUID(),
                    example: false,
                  },
                ]);
                close();
              } else {
                if (selected) {
                  saveServers(
                    servers.map((s) =>
                      s.id === selected.id
                        ? {
                            ...s,
                            name: draft.name.trim() || s.name,
                            address: draft.address.trim() || s.address,
                            port: draft.port.trim() || s.port,
                            username: draft.username.trim() || s.username,
                          }
                        : s,
                    ),
                  );
                }
                setPassword("");
                setNotice(t.unavailable);
              }
            }}
          >
            {(["name", "address", "port", "username"] as const).map((field) => (
              <div key={field}>
                <label
                  htmlFor={prefix + field}
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  {t[field]}
                </label>
                <input
                  id={prefix + field}
                  className={fieldClass}
                  value={draft[field]}
                  required
                  type={field === "port" ? "number" : "text"}
                  min={field === "port" ? 1 : undefined}
                  max={field === "port" ? 65535 : undefined}
                  pattern={field === "port" ? undefined : ".*\\S.*"}
                  autoComplete="off"
                  onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                />
              </div>
            ))}
            {!creating && (
              <div>
                <label
                  htmlFor={`${prefix}password`}
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  {t.password}
                </label>
                <input
                  id={`${prefix}password`}
                  type="password"
                  value={password}
                  autoComplete="off"
                  className={fieldClass}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            )}
            {notice && (
              <p role="status" className="text-sm text-muted">
                {notice}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {!creating && selected && (
                <>
                  <button
                    type="button"
                    className={cn(settingsDangerButtonClass, "mr-auto")}
                    onClick={() => {
                      saveServers(servers.filter((s) => s.id !== selected.id));
                      close();
                    }}
                  >
                    <Icon name="trash" size="xs" />
                    {t.delete}
                  </button>
                  <button type="button" className={buttonClass} onClick={copySshCommand}>
                    <Icon name="copy" size="xs" />
                    {t.copyCommand}
                  </button>
                </>
              )}
              <GlassDialogClose asChild>
                <button type="button" className={buttonClass}>
                  {t.cancel}
                </button>
              </GlassDialogClose>
              <button type="submit" className={settingsPrimaryButtonClass}>
                {creating ? t.add : t.login}
              </button>
            </div>
          </form>
        </GlassDialogContent>
      </GlassDialog>
    </div>
  );
}
