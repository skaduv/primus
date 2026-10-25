// RPC 记录与 primus:* 数据的 TS 类型定义（第 7 章、附录 A）。
// 字段须与锁定版本的 Core RPC 文档逐项对照（agent-core/packages/coding-agent/docs/rpc*.md、json.md）。
// 这里只定义前端用到的字段；Core 新增的字段原样保留在记录里，不做校验。

/** primus:* widget 数据的统一外壳 */
export interface PrimusData<T = unknown> {
  v: 1;
  type: string;
  data: T;
}

// ---------- 前端 → Core：命令 ----------

/** RPC 命令。`id` 由前端生成：`<sessionKey>-<自增序号>`（第 7.2 节） */
export interface RpcCommand {
  id: string;
  type: string;
  [field: string]: unknown;
}

export interface PromptCommand extends RpcCommand {
  type: "prompt";
  message: string;
  streamingBehavior?: "steer" | "followUp";
}

// ---------- Core → 前端：响应 ----------

export interface RpcResponse<T = unknown> {
  type: "response";
  id?: string;
  command: string;
  success: boolean;
  data?: T;
  error?: string;
}

// ---------- Core → 前端：会话事件（json.md） ----------

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface TextContent {
  type: "text";
  text: string;
}
export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}
export interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
export type AssistantContent = TextContent | ThinkingContent | ToolCallContent;

export interface UserMessage {
  role: "user";
  content: string | Array<TextContent | { type: "image"; [field: string]: unknown }>;
  timestamp: number;
}
export interface AssistantMessage {
  role: "assistant";
  content: AssistantContent[];
  stopReason?: string;
  usage?: Usage;
  timestamp?: number;
  [field: string]: unknown;
}
export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: Array<TextContent | { type: string; [field: string]: unknown }>;
  isError: boolean;
  timestamp?: number;
  [field: string]: unknown;
}
export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | { role: string; [field: string]: unknown };

/** message_update 内的增量事件（线上格式已去掉 partial 快照） */
export type AssistantMessageEvent =
  | { type: "text_start" | "thinking_start"; contentIndex: number }
  | {
      type: "text_delta" | "thinking_delta" | "toolcall_delta";
      contentIndex: number;
      delta: string;
    }
  | { type: "text_end" | "thinking_end"; contentIndex: number; content: string }
  | { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCallContent };

export interface ToolResult {
  content: Array<TextContent | { type: string; [field: string]: unknown }>;
  details?: unknown;
}

export type SessionEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[]; willRetry: boolean }
  | { type: "agent_settled"; aborted: boolean }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; usage: Usage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      partialResult: ToolResult;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: ToolResult;
      isError: boolean;
    }
  | { type: "queue_update"; steering: string[]; followUp: string[] };

// ---------- 扩展 UI（rpc-extension-ui.md） ----------

export interface ExtensionUiRequest {
  type: "extension_ui_request";
  id: string;
  method: string;
  [field: string]: unknown;
}

export interface ExtensionUiResponse {
  type: "extension_ui_response";
  id: string;
  [field: string]: unknown;
}

/** Core 发给前端的一条记录。未列出的事件类型按 `{ type: string }` 原样透传 */
export type CoreRecord =
  | RpcResponse
  | SessionEvent
  | ExtensionUiRequest
  | { type: string; [field: string]: unknown };

// ---------- 薄壳 → 前端：批次（第 7.3 节） ----------

export interface CoreBatch {
  sessionKey: string;
  /** 按会话单调递增；不连续时前端用 get_messages + get_state 重建 */
  seq: number;
  records: CoreRecord[];
  /** 薄壳缓冲溢出时丢弃的记录数 */
  dropped: number;
}
