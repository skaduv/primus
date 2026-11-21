"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/glass-tabs";
import { Switch } from "@/components/ui/switch";
import { getPlatform, type TrustDetails, type WorkspaceInfo } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { useAppStore } from "@/stores/app-store";
import { McpSettings } from "../capabilities/mcp-settings";
import { SkillsSettings } from "../capabilities/skills-settings";
import { Row, Section, SettingsSelect, settingsButtonClass } from "./settings-section";

const t = strings.settings.capabilityExtras;
const categories = ["skills", "mcp", "plugins", "connectors"] as const;

export function CapabilitySettings() {
  const [tab, setTab] = useState("skills");
  const [visited, setVisited] = useState(() => new Set(["skills"]));
  const currentWorkspace = useAppStore((state) => state.workspace);
  const setGlobalWorkspace = useAppStore((state) => state.setWorkspace);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const [inspection, setInspection] = useState<{ path: string; details: TrustDetails | null }>();
  const choices =
    currentWorkspace && !workspaces?.some((workspace) => workspace.path === currentWorkspace.path)
      ? [currentWorkspace, ...(workspaces ?? [])]
      : (workspaces ?? []);
  const path = selectedPath || currentWorkspace?.path || choices[0]?.path || "";
  const trusted = choices.some((workspace) => workspace.path === path && workspace.trusted);
  const inspected = inspection?.path === path ? inspection : undefined;

  useEffect(() => {
    let active = true;
    getPlatform()
      .then((platform) => platform.workspaceList())
      .then((items) => {
        if (active) setWorkspaces(items);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!path) return;
    let active = true;
    getPlatform()
      .then((platform) => platform.workspaceInspect(path))
      .then((details) => {
        if (active) setInspection({ path, details });
      })
      .catch(() => {
        if (active) setInspection({ path, details: null });
      });
    return () => {
      active = false;
    };
  }, [path]);

  async function pickWorkspaceFolder() {
    try {
      const platform = await getPlatform();
      const folder = await platform.dialogPickFolder?.();
      if (!folder) return;
      const opened = await platform.workspaceOpen?.(folder);
      if (!opened) return;
      setWorkspaces((prev) => [opened, ...(prev ?? []).filter((w) => w.path !== opened.path)]);
      setSelectedPath(opened.path);
      setGlobalWorkspace(opened);
    } catch {
      // 取消或读取失败时保持当前选择
    }
  }

  async function toggleTrust(nextTrusted: boolean) {
    if (!path) return;
    try {
      const platform = await getPlatform();
      await platform.workspaceTrust?.(path, nextTrusted);
      setWorkspaces((prev) =>
        (prev ?? []).map((w) =>
          w.path === path ? { ...w, trusted: nextTrusted, needsTrust: false } : w,
        ),
      );
      // 请求期间用户可能已切换项目：读取最新全局工作区，只在仍是同一路径时更新
      const latest = useAppStore.getState().workspace;
      if (latest?.path === path) {
        setGlobalWorkspace({ ...latest, trusted: nextTrusted, needsTrust: false });
      }
    } catch {
      // 忽略写入失败
    }
  }

  const items = {
    // 项目技能来自 `.primus/skills`（skills）与 `.agents/skills`（agentsSkills，保留目录前缀）
    skills: inspected?.details
      ? [...inspected.details.skills, ...inspected.details.agentsSkills]
      : undefined,
    mcp: inspected?.details?.mcpServers,
    plugins: inspected?.details?.extensions,
    connectors: undefined,
  };

  return (
    <Tabs
      className="w-full min-w-0 gap-6"
      value={tab}
      onValueChange={(value) => {
        setTab(value);
        setVisited((previous) => (previous.has(value) ? previous : new Set([...previous, value])));
      }}
    >
      <TabsList aria-label={strings.settings.groups.capabilities} className="self-start">
        {categories.map((category) => (
          <TabsTrigger key={category} value={category}>
            {t.tabs[category]}
          </TabsTrigger>
        ))}
      </TabsList>
      {categories.map((category) => {
        if (!visited.has(category)) return null;
        const entries = items[category];
        let status: string = t.empty;
        if (category === "connectors") status = t.unavailable;
        else if (inspected?.details === null || (!path && failed)) status = t.loadFailed;
        else if (!workspaces && !failed && !path) status = t.loading;
        else if (!path) status = t.selectWorkspace;
        else if (!inspected) status = t.loading;
        return (
          <TabsContent
            key={category}
            value={category}
            forceMount
            hidden={tab !== category}
            className="settings-pane-in min-w-0 w-full space-y-6"
          >
            {category === "skills" && <SkillsSettings />}
            {category === "mcp" && <McpSettings />}
            <Section title={t.tabs[category]} description={t.descriptions[category]}>
              {
                <Row icon="folder" label={t.workspace} hint={path || t.selectWorkspace}>
                  <div className="flex flex-wrap items-center gap-2">
                    {choices.length > 0 && (
                      <SettingsSelect
                        aria-label={t.workspace}
                        value={path}
                        onChange={(e) => setSelectedPath(e.currentTarget.value)}
                      >
                        {choices.map((ws) => (
                          <option key={ws.path} value={ws.path}>
                            {ws.name}
                          </option>
                        ))}
                      </SettingsSelect>
                    )}
                    <button
                      type="button"
                      onClick={() => void pickWorkspaceFolder()}
                      className={settingsButtonClass}
                    >
                      <Icon name="folder-open" size="xs" />
                      {t.addWorkspace}
                    </button>
                  </div>
                </Row>
              }
              {path && (
                <Row icon="shield-check" label={t.trustedSwitch} hint={t.trustedHint}>
                  <Switch
                    ariaLabel={t.trustedSwitch}
                    checked={trusted}
                    onCheckedChange={(checked) => void toggleTrust(checked)}
                  />
                </Row>
              )}
              {entries?.length ? (
                Array.from(new Set(entries)).map((name) => (
                  <Row key={name} label={name} hint={trusted ? t.declared : t.untrusted}>
                    <button
                      type="button"
                      disabled
                      aria-label={t.unavailable}
                      className={settingsButtonClass}
                    >
                      {t.unavailable}
                    </button>
                  </Row>
                ))
              ) : (
                <p role="status" className="px-4 py-4 text-xs text-muted">
                  {status}
                </p>
              )}
            </Section>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
