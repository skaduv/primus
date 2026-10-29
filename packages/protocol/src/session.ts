// 会话条目（session-format.md）：get_entries、get_tree 的返回值与 entry_appended 事件使用。
// 条目组成一棵树：id / parentId；条目 timestamp 是 ISO 8601 字符串。

import type {
  AgentMessage,
  AssistantMessage,
  CustomMessage,
  SystemMessage,
  ToolResultMessage,
  Usage,
  UserContent,
  UserMessage,
} from "./content.ts";

export interface SessionEntryBase {
  type: string;
  /** 通常是 8 位十六进制，也可能是完整 UUID */
  id: string;
  /** 根条目为 null */
  parentId: string | null;
  timestamp: string;
}

export interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

export interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

/** 不属于助手消息、也不进入上下文的模型用量（如 `cache_warm`）。未知 kind 按普通用量处理 */
export interface UsageEntry extends SessionEntryBase {
  type: "usage";
  kind: string;
  provider: string;
  model: string;
  usage: Usage;
  note?: string;
}

export interface CompactionEntry<T = unknown> extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
  usage?: Usage;
  /** 由扩展生成时为 true */
  fromHook?: boolean;
  /** 压缩边界处完整的提示与工具状态 */
  systemMessage?: SystemMessage;
}

export interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: T;
  usage?: Usage;
  fromHook?: boolean;
}

/** 扩展状态持久化，不进入上下文 */
export interface CustomEntry<T = unknown> extends SessionEntryBase {
  type: "custom";
  customType: string;
  data?: T;
}

/** 扩展注入的消息，进入上下文 */
export interface CustomMessageEntry<T = unknown> extends SessionEntryBase {
  type: "custom_message";
  customType: string;
  content: string | UserContent[];
  details?: T;
  display: boolean;
}

export type ContextEditableContent =
  | UserMessage["content"]
  | AssistantMessage["content"]
  | ToolResultMessage["content"]
  | CustomMessage["content"];

/** 对之前某条条目在模型上下文中的贡献做追加式修改；`replacement: null` 表示从上下文中省略 */
export interface ContextEditEntry extends SessionEntryBase {
  type: "context_edit";
  targetId: string;
  replacement: { content: ContextEditableContent } | null;
}

/** 书签；`label` 缺省表示清除 */
export interface LabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;
  label?: string;
}

export interface SessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  name?: string;
}

export type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | UsageEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | ContextEditEntry
  | LabelEntry
  | SessionInfoEntry;

export type SessionEntryType = SessionEntry["type"];

export const SESSION_ENTRY_TYPES = [
  "message",
  "thinking_level_change",
  "model_change",
  "usage",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "context_edit",
  "label",
  "session_info",
] as const satisfies readonly SessionEntryType[];

export interface SessionTreeNode {
  entry: SessionEntry;
  children: SessionTreeNode[];
  label?: string;
  labelTimestamp?: string;
}
