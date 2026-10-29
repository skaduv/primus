// Core → 前端：会话事件（json.md）。会话事件一般不带 id；bash_execution_update 例外，带原 bash 命令的 id。
// 流式重建（第 7.4 节）：message_update 按 contentIndex 追加增量；*_end 用完整内容替换；
// message_end 是该消息的最终版本；agent_end 之后仍可能有重试、压缩或排队消息，agent_settled 才表示本轮结束。

import type {
  AgentMessage,
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingLevel,
  ToolCall,
  ToolResultMessage,
  Usage,
} from "./content.ts";
import type { CompactionResult } from "./responses.ts";
import type { SessionEntry } from "./session.ts";

// ---------- message_update 中的增量事件 ----------

/**
 * 线上格式的助手消息增量事件：已去掉 SDK 事件中的累积快照（partial），只保留增量。
 * `start`、`done`、`error` 在正常运行中会被转成 message_start / message_end，一般不会出现在 message_update 里，
 * 但协议允许，消费方应能容忍。
 */
export type AssistantMessageEvent =
  | { type: "start" }
  | { type: "text_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; content: string }
  | { type: "thinking_start"; contentIndex: number }
  | { type: "thinking_delta"; contentIndex: number; delta: string }
  | { type: "thinking_end"; contentIndex: number; content: string }
  | { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
  /** 追加序列化后的参数片段 */
  | { type: "toolcall_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall }
  | { type: "done"; reason: "stop" | "length" | "toolUse" | "deferred"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };

export type AssistantMessageEventType = AssistantMessageEvent["type"];

/** 带 contentIndex（作用于某个内容块）的增量事件 */
export type ContentBlockEvent = Extract<AssistantMessageEvent, { contentIndex: number }>;

export const ASSISTANT_MESSAGE_EVENT_TYPES = [
  "start",
  "text_start",
  "text_delta",
  "text_end",
  "thinking_start",
  "thinking_delta",
  "thinking_end",
  "toolcall_start",
  "toolcall_delta",
  "toolcall_end",
  "done",
  "error",
] as const satisfies readonly AssistantMessageEventType[];

// ---------- 工具执行结果 ----------

/**
 * tool_execution_update 的 partialResult 与 tool_execution_end 的 result。
 * 具体形状由各工具决定（Core 侧类型为 any）；内置工具与扩展工具遵循这个结构。
 */
export interface ToolResult<TDetails = unknown> {
  content: Array<TextContent | ImageContent>;
  details?: TDetails;
  /** 供程序调用方使用的结构化结果，不发给模型 */
  structuredContent?: unknown;
  usage?: Usage;
}

export type CompactionReason = "manual" | "threshold" | "overflow";

// ---------- 会话事件 ----------

export interface AgentStartEvent {
  type: "agent_start";
}
export interface AgentEndEvent {
  type: "agent_end";
  /** 本次运行产生的消息 */
  messages: AgentMessage[];
  willRetry: boolean;
}
/** 不会再自动继续（重试、压缩恢复、排队消息都已结束）；前端此时解锁输入框 */
export interface AgentSettledEvent {
  type: "agent_settled";
  aborted: boolean;
}
export interface TurnStartEvent {
  type: "turn_start";
}
export interface TurnEndEvent {
  type: "turn_end";
  message: AgentMessage;
  toolResults: ToolResultMessage[];
}
export interface MessageStartEvent {
  type: "message_start";
  message: AgentMessage;
}
export interface MessageUpdateEvent {
  type: "message_update";
  /** 该助手响应最新的累积用量；部分供应商在结束前一直为 0 */
  usage: Usage;
  assistantMessageEvent: AssistantMessageEvent;
}
export interface MessageEndEvent {
  type: "message_end";
  message: AgentMessage;
}

interface ToolExecutionBase {
  toolCallId: string;
  toolName: string;
  /** 工具通过 ctx.executeTool() 发起的嵌套调用带上发起它的工具调用 id */
  parentToolCallId?: string;
}
export interface ToolExecutionStartEvent extends ToolExecutionBase {
  type: "tool_execution_start";
  args: Record<string, unknown>;
}
export interface ToolExecutionUpdateEvent extends ToolExecutionBase {
  type: "tool_execution_update";
  args: Record<string, unknown>;
  /** 最新的部分结果；替换还是追加由该工具的约定决定 */
  partialResult: ToolResult;
}
export interface ToolExecutionEndEvent extends ToolExecutionBase {
  type: "tool_execution_end";
  result: ToolResult;
  isError: boolean;
  /** execute() 的耗时（单调时钟）；工具未运行时缺省 */
  durationMs?: number;
}

/** 两个字段都是当前完整队列 */
export interface QueueUpdateEvent {
  type: "queue_update";
  steering: string[];
  followUp: string[];
}
/** 扩展追加了自定义会话条目 */
export interface EntryAppendedEvent {
  type: "entry_appended";
  entry: SessionEntry;
}
/** 会话显示名称变化；`name` 缺省表示清除 */
export interface SessionInfoChangedEvent {
  type: "session_info_changed";
  name?: string;
}
export interface ThinkingLevelChangedEvent {
  type: "thinking_level_changed";
  level: ThinkingLevel;
}

export interface CompactionStartEvent {
  type: "compaction_start";
  reason: CompactionReason;
}
/** 成功时有 result；中止时 aborted 为 true；失败时 errorMessage 说明原因；溢出恢复成功后 willRetry 为 true */
export interface CompactionEndEvent {
  type: "compaction_end";
  reason: CompactionReason;
  result?: CompactionResult;
  aborted: boolean;
  willRetry: boolean;
  errorMessage?: string;
}

export interface AutoRetryStartEvent {
  type: "auto_retry_start";
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}
/** 最终失败时 success 为 false 并带 finalError */
export interface AutoRetryEndEvent {
  type: "auto_retry_end";
  success: boolean;
  attempt: number;
  finalError?: string;
}

export interface SummarizationRetryScheduledEvent {
  type: "summarization_retry_scheduled";
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}
export type SummarizationRetryAttemptStartEvent =
  | { type: "summarization_retry_attempt_start"; source: "branchSummary" }
  | { type: "summarization_retry_attempt_start"; source: "compaction"; reason: CompactionReason };
export interface SummarizationRetryFinishedEvent {
  type: "summarization_retry_finished";
}

/** RPC bash 命令的输出片段；`id` 与原命令一致（原命令没有 id 时缺省） */
export interface BashExecutionUpdateEvent {
  type: "bash_execution_update";
  id?: string;
  delta: string;
}

/** JSON 与 RPC 模式共用的会话事件 */
export type SessionEvent =
  | AgentStartEvent
  | AgentEndEvent
  | AgentSettledEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent
  | QueueUpdateEvent
  | EntryAppendedEvent
  | SessionInfoChangedEvent
  | ThinkingLevelChangedEvent
  | CompactionStartEvent
  | CompactionEndEvent
  | AutoRetryStartEvent
  | AutoRetryEndEvent
  | SummarizationRetryScheduledEvent
  | SummarizationRetryAttemptStartEvent
  | SummarizationRetryFinishedEvent
  | BashExecutionUpdateEvent;

export type SessionEventType = SessionEvent["type"];

export const SESSION_EVENT_TYPES = [
  "agent_start",
  "agent_end",
  "agent_settled",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "queue_update",
  "entry_appended",
  "session_info_changed",
  "thinking_level_changed",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "bash_execution_update",
] as const satisfies readonly SessionEventType[];

/** RPC 独有：扩展处理器抛出异常 */
export interface ExtensionErrorEvent {
  type: "extension_error";
  extensionPath: string;
  /** 抛出异常的扩展事件名，如 `tool_call` */
  event: string;
  error: string;
}
