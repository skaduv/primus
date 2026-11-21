import { create } from "zustand";
import { getPlatform } from "@/lib/platform";
import { type PermissionMode, useAppStore } from "./app-store";

export type AgentModelMode = "automatic" | "manual";
export type AgentReplyStyle = "简洁" | "标准" | "详细";
export type AgentReplyLanguage = "跟随提问语言" | "简体中文" | "English";
export type AgentPlanMode = "自动" | "开启" | "关闭";

export interface SshServerConfig {
  id: string;
  name: string;
  address: string;
  port: string;
  username: string;
  example?: boolean;
}

export interface PersistedSettings {
  minimizeToTray: boolean;
  agentModelMode: AgentModelMode;
  agentReplyStyle: AgentReplyStyle;
  agentReplyLanguage: AgentReplyLanguage;
  agentPlanMode: AgentPlanMode;
  advancedEnabled: boolean;
  sshServers: SshServerConfig[] | null;
}

export const DEFAULT_PERSISTED_SETTINGS: PersistedSettings = {
  minimizeToTray: false,
  agentModelMode: "manual",
  agentReplyStyle: "标准",
  agentReplyLanguage: "跟随提问语言",
  agentPlanMode: "自动",
  advancedEnabled: false,
  sshServers: null,
};

interface SettingsStoreState extends PersistedSettings {
  loaded: boolean;
  saving: boolean;
  error: string | null;
  load: () => Promise<void>;
  patch: (
    partial: Partial<PersistedSettings> & {
      permissionMode?: PermissionMode;
      autoCompaction?: boolean;
    },
  ) => Promise<void>;
}

const VALID_MODEL_MODES = new Set<string>(["automatic", "manual"]);
const VALID_STYLES = new Set<string>(["简洁", "标准", "详细"]);
const VALID_LANGS = new Set<string>(["跟随提问语言", "简体中文", "English"]);
const VALID_PLANS = new Set<string>(["自动", "开启", "关闭"]);
const VALID_PERMS = new Set<string>(["ask", "edit", "full"]);

function parseSshServers(raw: unknown): SshServerConfig[] | null {
  if (!Array.isArray(raw)) return null;
  const list: SshServerConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.id === "string" &&
      typeof r.name === "string" &&
      typeof r.address === "string" &&
      typeof r.port === "string" &&
      typeof r.username === "string"
    ) {
      list.push({
        id: r.id,
        name: r.name,
        address: r.address,
        port: r.port,
        username: r.username,
        example: r.example === true,
      });
    }
  }
  return list;
}

function parseRaw(raw: Record<string, unknown>): PersistedSettings {
  return {
    minimizeToTray:
      typeof raw.minimizeToTray === "boolean"
        ? raw.minimizeToTray
        : DEFAULT_PERSISTED_SETTINGS.minimizeToTray,
    agentModelMode:
      typeof raw.agentModelMode === "string" && VALID_MODEL_MODES.has(raw.agentModelMode)
        ? (raw.agentModelMode as AgentModelMode)
        : DEFAULT_PERSISTED_SETTINGS.agentModelMode,
    agentReplyStyle:
      typeof raw.agentReplyStyle === "string" && VALID_STYLES.has(raw.agentReplyStyle)
        ? (raw.agentReplyStyle as AgentReplyStyle)
        : DEFAULT_PERSISTED_SETTINGS.agentReplyStyle,
    agentReplyLanguage:
      typeof raw.agentReplyLanguage === "string" && VALID_LANGS.has(raw.agentReplyLanguage)
        ? (raw.agentReplyLanguage as AgentReplyLanguage)
        : DEFAULT_PERSISTED_SETTINGS.agentReplyLanguage,
    agentPlanMode:
      typeof raw.agentPlanMode === "string" && VALID_PLANS.has(raw.agentPlanMode)
        ? (raw.agentPlanMode as AgentPlanMode)
        : DEFAULT_PERSISTED_SETTINGS.agentPlanMode,
    advancedEnabled:
      typeof raw.advancedEnabled === "boolean"
        ? raw.advancedEnabled
        : DEFAULT_PERSISTED_SETTINGS.advancedEnabled,
    sshServers: parseSshServers(raw.sshServers),
  };
}

let settingsRev = 0;
let pendingSaves = 0;
const fieldOwner = new Map<string, number>();
const PERSISTED_KEYS = Object.keys(DEFAULT_PERSISTED_SETTINGS) as (keyof PersistedSettings)[];

export const useSettingsStore = create<SettingsStoreState>()((set, get) => ({
  ...DEFAULT_PERSISTED_SETTINGS,
  loaded: false,
  saving: false,
  error: null,
  load: async () => {
    const rev = ++settingsRev;
    try {
      const platform = await getPlatform();
      const raw = await platform.settingsGet();
      if (rev !== settingsRev) return;
      const parsed = parseRaw(raw ?? {});
      set({ ...parsed, loaded: true, error: null });
      if (typeof raw?.permissionMode === "string" && VALID_PERMS.has(raw.permissionMode)) {
        useAppStore.getState().setPermissionMode(raw.permissionMode as PermissionMode);
      }
      if (typeof raw?.autoCompaction === "boolean") {
        useAppStore.getState().setAutoCompaction(raw.autoCompaction);
      }
    } catch {
      if (rev === settingsRev) set({ loaded: true });
    }
  },
  patch: async (partial) => {
    settingsRev++;
    const { permissionMode, autoCompaction, ...persistedPatch } = partial;
    const prev = get();
    const prevPerm = useAppStore.getState().permissionMode;
    const prevCompact = useAppStore.getState().autoCompaction;
    // 每个字段记录最近一次写入它的操作；失败时只回滚仍归本次操作所有的字段，
    // 避免较早请求失败覆盖较晚请求已成功保存的值
    const owned: Record<string, number> = {};
    for (const key of Object.keys(partial)) {
      if ((partial as Record<string, unknown>)[key] === undefined) continue;
      const v = (fieldOwner.get(key) ?? 0) + 1;
      fieldOwner.set(key, v);
      owned[key] = v;
    }
    const stillOwns = (key: string) =>
      owned[key] !== undefined && fieldOwner.get(key) === owned[key];

    pendingSaves++;
    if (Object.keys(persistedPatch).length > 0) {
      set({ ...persistedPatch, saving: true, error: null });
    } else {
      set({ saving: true, error: null });
    }
    if (permissionMode !== undefined) useAppStore.getState().setPermissionMode(permissionMode);
    if (autoCompaction !== undefined) useAppStore.getState().setAutoCompaction(autoCompaction);

    try {
      const platform = await getPlatform();
      await platform.settingsSet(partial as Record<string, unknown>);
      pendingSaves--;
      set({ saving: pendingSaves > 0 });
    } catch (e) {
      pendingSaves--;
      const rollback: Partial<PersistedSettings> = {};
      for (const key of PERSISTED_KEYS) {
        if (stillOwns(key)) {
          (rollback as Record<string, unknown>)[key] = prev[key];
        }
      }
      set({
        ...rollback,
        saving: pendingSaves > 0,
        error: e instanceof Error && e.message ? e.message : "保存设置失败",
      });
      if (stillOwns("permissionMode")) useAppStore.getState().setPermissionMode(prevPerm);
      if (stillOwns("autoCompaction")) useAppStore.getState().setAutoCompaction(prevCompact);
    }
  },
}));

export function resetSettingsStoreForTesting() {
  pendingSaves = 0;
  fieldOwner.clear();
  useSettingsStore.setState({
    ...DEFAULT_PERSISTED_SETTINGS,
    loaded: false,
    saving: false,
    error: null,
  });
}
