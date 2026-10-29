// Core → 前端：命令响应（rpc-commands.md）。每条命令恰好一条 response，按 `id` 关联（不要依赖顺序）。
// `success: true` 只表示命令已受理；prompt 受理后的失败与中止走事件流，不会再有第二条 response。

import type { QueueMode, RpcCommandType } from "./commands.ts";
import type { AgentMessage, ThinkingLevel, Usage } from "./content.ts";
import type { Model } from "./model.ts";
import type { SessionEntry, SessionTreeNode } from "./session.ts";

// ---------- 响应数据 ----------

/** steer / follow_up 的去向：被输入处理器消费，或进入队列 */
export type QueuedInputDisposition = "handled" | "queued";
/** prompt 的去向；`handled` 表示没有启动运行，不要等 agent_settled */
export type PromptDisposition = QueuedInputDisposition | "started";

export interface RpcSessionState {
  /** 未选择模型时缺省 */
  model?: Model;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: QueueMode;
  followUpMode: QueueMode;
  sessionFile?: string;
  sessionId: string;
  /** 未设置显示名称时缺省 */
  sessionName?: string;
  autoCompactionEnabled: boolean;
  messageCount: number;
  pendingMessageCount: number;
}

export interface ModelCycleResult {
  model: Model;
  thinkingLevel: ThinkingLevel;
  /** 是否在启动参数限定的模型范围内轮换 */
  isScoped: boolean;
}

export interface CompactionResult<T = unknown> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  /** 压缩后上下文的估算值，不是供应商精确计数 */
  estimatedTokensAfter?: number;
  /** 生成摘要的模型调用用量；自定义压缩处理器可能不提供 */
  usage?: Usage;
  details?: T;
}

export interface BashResult {
  /** stdout + stderr 合并输出，可能被截断 */
  output: string;
  /** 被终止或取消时缺省 */
  exitCode?: number;
  cancelled: boolean;
  truncated: boolean;
  /** 截断时完整输出所在的临时文件 */
  fullOutputPath?: string;
}

export interface ContextUsage {
  /** 压缩后、下一次助手响应前为 null */
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface SessionStats {
  sessionFile?: string;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  /** 没有模型或上下文窗口时缺省 */
  contextUsage?: ContextUsage;
}

export interface SourceInfo {
  /** 资源的绝对路径 */
  path: string;
  /** 发现方式，如 `local`、`auto`、`cli` */
  source: string;
  scope: "user" | "project" | "temporary";
  origin: "top-level" | "package";
  baseDir?: string;
}

/** get_commands 返回的一条可调用命令（名称不含前导 `/`） */
export interface RpcSlashCommand {
  name: string;
  /** 扩展命令可能没有描述 */
  description?: string;
  /** `skill` 的名称带 `skill:` 前缀 */
  source: "extension" | "prompt" | "skill";
  sourceInfo: SourceInfo;
}

/**
 * 各命令成功响应的 `data`。值为 `undefined` 的命令，响应里没有 `data` 字段；
 * 联合中含 `null` 的表示 Core 可能返回 `data: null`。
 */
export interface RpcResponseDataMap {
  prompt: { disposition: PromptDisposition };
  steer: { disposition: QueuedInputDisposition };
  follow_up: { disposition: QueuedInputDisposition };
  abort: undefined;
  clear_queue: { steering: string[]; followUp: string[] };
  /** 被扩展的 session_before_switch 取消时 cancelled 为 true */
  new_session: { cancelled: boolean };
  get_state: RpcSessionState;
  get_messages: { messages: AgentMessage[] };
  set_model: Model;
  /** 只有一个可用模型时为 null */
  cycle_model: ModelCycleResult | null;
  get_available_models: { models: Model[] };
  set_thinking_level: undefined;
  /** 模型不支持思考时为 null */
  cycle_thinking_level: { level: ThinkingLevel } | null;
  /** 不支持思考的模型返回 `["off"]` */
  get_available_thinking_levels: { levels: ThinkingLevel[] };
  set_steering_mode: undefined;
  set_follow_up_mode: undefined;
  compact: CompactionResult;
  set_auto_compaction: undefined;
  set_auto_retry: undefined;
  abort_retry: undefined;
  bash: BashResult;
  abort_bash: undefined;
  get_session_stats: SessionStats;
  export_html: { path: string };
  switch_session: { cancelled: boolean };
  /** 被扩展取消时没有 text */
  fork: { text?: string; cancelled: boolean };
  clone: { cancelled: boolean };
  get_fork_messages: { messages: Array<{ entryId: string; text: string }> };
  /** leafId：当前叶子条目，空会话为 null */
  get_entries: { entries: SessionEntry[]; leafId: string | null };
  get_tree: { tree: SessionTreeNode[]; leafId: string | null };
  /** 没有助手文本时为 null */
  get_last_assistant_text: { text: string | null };
  set_session_name: undefined;
  get_commands: { commands: RpcSlashCommand[] };
}

// ---------- 响应记录 ----------

interface ResponseBase {
  id?: string;
  type: "response";
}

type SuccessResponseOf<C extends RpcCommandType> = ResponseBase & {
  command: C;
  success: true;
} & (RpcResponseDataMap[C] extends undefined ? unknown : { data: RpcResponseDataMap[C] });

/** 成功响应，按命令区分 `data` 的形状 */
export type RpcSuccessResponse<C extends RpcCommandType = RpcCommandType> = {
  [K in C]: SuccessResponseOf<K>;
}[C];

/**
 * 失败响应。任何命令都可能失败；JSON 解析失败时 `command` 为 `parse` 且没有 `id`，
 * 不认识的命令 `command` 为其原始 type。
 */
export interface RpcErrorResponse extends ResponseBase {
  command: string;
  success: false;
  error: string;
}

export type RpcResponse = RpcSuccessResponse | RpcErrorResponse;

/** 某条命令可能得到的响应 */
export type RpcResponseFor<C extends RpcCommandType> = RpcSuccessResponse<C> | RpcErrorResponse;

/** 某条命令成功时的 `data`（没有 data 的命令为 `undefined`） */
export type RpcResponseData<C extends RpcCommandType> = RpcResponseDataMap[C];
