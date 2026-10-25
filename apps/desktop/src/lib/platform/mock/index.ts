import type { AgentMessage, CoreRecord, RpcCommand, RpcResponse } from "@primus/protocol";
import type { BatchListener, Platform, SessionSummary, WorkspaceInfo } from "../types";
import { promptScenario } from "./scenario";

// 浏览器预览用的 mock 平台（第 16.1.1 节）：不依赖 Tauri 与 Rust，
// 会话命令由脚本化的假 Core 处理，事件按"每 16ms 一批"推送，与薄壳的合批节奏一致（第 16.4 节）。

export interface MockOptions {
  /** 批次间隔，默认 16ms */
  intervalMs?: number;
  /** 每批最多几条记录，默认 4 */
  batchSize?: number;
  /** 时钟（测试可注入） */
  now?: () => number;
}

interface MockSession {
  key: string;
  workspace: string;
  onBatch: BatchListener;
  seq: number;
  messages: AgentMessage[];
  queue: CoreRecord[];
  timer: ReturnType<typeof setTimeout> | undefined;
  streaming: boolean;
  closed: boolean;
}

const MOCK_WORKSPACE = "C:\\Users\\mock\\示例工作区";

export function createMockPlatform(options: MockOptions = {}): Platform {
  const intervalMs = options.intervalMs ?? 16;
  const batchSize = options.batchSize ?? 4;
  const now = options.now ?? Date.now;
  const sessions = new Map<string, MockSession>();
  const workspaces = new Map<string, WorkspaceInfo>([
    [MOCK_WORKSPACE, { path: MOCK_WORKSPACE, name: "示例工作区", trusted: true }],
  ]);
  const sessionIndex: SessionSummary[] = [];
  let settings: Record<string, unknown> = {};
  let nextSession = 1;
  let nextTerminal = 1;

  const session = (key: string): MockSession => {
    const s = sessions.get(key);
    if (!s || s.closed) throw new Error(`会话不存在或已关闭：${key}`);
    return s;
  };

  const flush = (s: MockSession) => {
    s.timer = undefined;
    if (s.closed || s.queue.length === 0) return;
    const records = s.queue.splice(0, batchSize);
    if (records.some((r) => r.type === "agent_settled")) s.streaming = false;
    s.seq += 1;
    s.onBatch({ sessionKey: s.key, seq: s.seq, records, dropped: 0 });
    schedule(s);
  };

  const schedule = (s: MockSession) => {
    if (s.timer === undefined && s.queue.length > 0)
      s.timer = setTimeout(() => flush(s), intervalMs);
  };

  const emit = (s: MockSession, ...records: CoreRecord[]) => {
    s.queue.push(...records);
    schedule(s);
  };

  const respond = (
    cmd: { id?: string; type: string },
    data?: unknown,
    error?: string,
  ): RpcResponse => ({
    type: "response",
    id: cmd.id,
    command: cmd.type,
    success: error === undefined,
    ...(error === undefined ? { data } : { error }),
  });

  const handle = (s: MockSession, cmd: RpcCommand) => {
    switch (cmd.type) {
      case "prompt": {
        if (s.streaming) {
          // 真实 Core 会按 streamingBehavior 排队；mock 只做最简单的拒绝
          emit(s, respond(cmd, undefined, "mock：正在运行中，请先停止或等待结束"));
          return;
        }
        const scenario = promptScenario(String(cmd.message ?? ""), now());
        s.streaming = true;
        s.messages.push(...scenario.messages);
        emit(s, respond(cmd, { disposition: "started" }), ...scenario.records);
        return;
      }
      case "abort": {
        const wasStreaming = s.streaming;
        // 丢弃尚未推送的事件，只保留已排队的响应
        s.queue = s.queue.filter((r) => r.type === "response");
        emit(s, respond(cmd));
        if (wasStreaming) {
          emit(
            s,
            { type: "agent_end", messages: [], willRetry: false },
            { type: "agent_settled", aborted: true },
          );
        }
        return;
      }
      case "get_state":
        emit(
          s,
          respond(cmd, {
            model: { provider: "mock", id: "mock-model", name: "Mock 模型" },
            thinkingLevel: "medium",
            isStreaming: s.streaming,
            sessionId: s.key,
            messageCount: s.messages.length,
            pendingMessageCount: 0,
          }),
        );
        return;
      case "get_messages":
        emit(s, respond(cmd, { messages: s.messages.slice() }));
        return;
      default:
        emit(s, respond(cmd, undefined, `mock：未实现命令 ${cmd.type}`));
    }
  };

  const notAvailable = async (what: string): Promise<never> => {
    throw new Error(`浏览器预览模式不支持：${what}`);
  };

  return {
    appInfo: async () => ({
      appVersion: "0.0.0-mock",
      coreVersion: "mock",
      dataDir: "C:\\Users\\mock\\AppData\\Roaming\\Primus",
      platform: "browser",
      runtime: "mock",
    }),

    workspaceOpen: async (path) => {
      const ws = workspaces.get(path) ?? {
        path,
        name: path.split(/[\\/]/).pop() || path,
        trusted: false,
      };
      workspaces.set(path, ws);
      return ws;
    },
    workspaceList: async () => [...workspaces.values()],
    workspaceTrust: async (path, trusted) => {
      const ws = workspaces.get(path);
      if (ws) ws.trusted = trusted;
    },

    sessionList: async (workspace) => ({
      items: sessionIndex.filter((x) => x.workspace === workspace),
    }),
    sessionSearch: async (workspace, query) =>
      sessionIndex.filter((x) => x.workspace === workspace && (x.name ?? "").includes(query)),
    sessionOpen: async (workspace, sessionPath, onBatch) => {
      const key = `mock-${nextSession++}`;
      sessions.set(key, {
        key,
        workspace,
        onBatch,
        seq: 0,
        messages: [],
        queue: [],
        timer: undefined,
        streaming: false,
        closed: false,
      });
      if (!sessionPath)
        sessionIndex.push({ path: `${key}.jsonl`, workspace, updatedAt: now(), name: "新会话" });
      return { sessionKey: key };
    },
    sessionClose: async (sessionKey) => {
      const s = sessions.get(sessionKey);
      if (!s) return;
      s.closed = true;
      if (s.timer !== undefined) clearTimeout(s.timer);
      sessions.delete(sessionKey);
    },
    sessionDelete: async (path) => {
      const i = sessionIndex.findIndex((x) => x.path === path);
      if (i >= 0) sessionIndex.splice(i, 1);
    },
    sessionArchive: async () => {},

    coreSend: async (sessionKey, record) => {
      const s = session(sessionKey);
      handle(s, record as RpcCommand);
    },
    coreRestart: async (sessionKey) => {
      const s = session(sessionKey);
      s.queue = [];
      s.streaming = false;
    },

    settingsGet: async () => ({ ...settings }),
    settingsSet: async (patch) => {
      settings = { ...settings, ...patch };
    },

    providerSave: async () => {},
    providerDelete: async () => {},
    providerTest: async () => ({ ok: true, message: "mock：未实际连接" }),

    shellDetect: async () => ({ shells: [{ kind: "powershell", version: "7.5.0" }] }),
    fsTree: async () => [{ name: "README.md", path: "README.md", kind: "file" }],
    fsRead: async () => "# 示例工作区\n\n这是 mock 平台返回的假文件内容。",
    gitStatus: async () => ({ branch: "main", changes: [] }),
    gitDiff: async () => "",

    terminalOpen: async (_cwd, onData) => {
      const terminalId = `mock-term-${nextTerminal++}`;
      setTimeout(() => onData("浏览器预览模式没有真实终端。\r\n"), 0);
      return { terminalId };
    },
    terminalWrite: async () => {},
    terminalResize: async () => {},
    terminalClose: async () => {},

    openExternal: async (target) => {
      globalThis.open?.(target, "_blank", "noopener");
    },
    storageUsage: async () => ({ sessions: 0, logs: 0, cache: 0 }),
    storageClean: async () => {},
    diagnosticsExport: () => notAvailable("导出诊断包"),
    updateCheck: async () => ({ available: false }),
    updateInstall: () => notAvailable("自动更新"),
    logWrite: async (level, message) => {
      console[level === "debug" ? "log" : level](`[mock] ${message}`);
    },
  };
}
