// 编译期契约校验（`pnpm --filter @primus/protocol typecheck`，不在运行时执行）。
// 1. 导出的名称清单与联合类型完全一致（缺项或多项都会编译失败）；
// 2. Core 文档中的 JSON 示例逐条用本包类型标注：字段名、必填与取值不符都会编译失败。
// 示例摘自 agent-core/packages/coding-agent/docs/ 下的 rpc-commands.md、json.md、rpc-extension-ui.md、session-format.md。

import type {
  AGENT_MESSAGE_ROLES,
  AgentMessageRole,
  ASSISTANT_MESSAGE_EVENT_TYPES,
  AssistantMessage,
  AssistantMessageEventType,
  CoreRecord,
  EXTENSION_UI_DIALOG_METHODS,
  EXTENSION_UI_METHODS,
  ExtensionUiDialogRequest,
  ExtensionUiMethod,
  ExtensionUiRequest,
  ExtensionUiResponse,
  Model,
  RPC_COMMAND_TYPES,
  RpcCommand,
  RpcCommandType,
  RpcResponse,
  RpcResponseFor,
  SESSION_ENTRY_TYPES,
  SESSION_EVENT_TYPES,
  SessionEntry,
  SessionEntryType,
  SessionEvent,
  SessionEventType,
  SessionTreeNode,
} from "./index.ts";

// ---------- 1. 清单与联合完全一致 ----------

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const exact = <T extends true>(_: T) => {};

exact<Equal<(typeof RPC_COMMAND_TYPES)[number], RpcCommandType>>(true);
exact<Equal<(typeof SESSION_EVENT_TYPES)[number], SessionEventType>>(true);
exact<Equal<(typeof ASSISTANT_MESSAGE_EVENT_TYPES)[number], AssistantMessageEventType>>(true);
exact<Equal<(typeof EXTENSION_UI_METHODS)[number], ExtensionUiMethod>>(true);
exact<Equal<(typeof EXTENSION_UI_DIALOG_METHODS)[number], ExtensionUiDialogRequest["method"]>>(
  true,
);
exact<Equal<(typeof AGENT_MESSAGE_ROLES)[number], AgentMessageRole>>(true);
exact<Equal<(typeof SESSION_ENTRY_TYPES)[number], SessionEntryType>>(true);
// 每条命令都有响应定义（RpcResponseDataMap 缺键时 RpcResponseFor 会报错）
exact<Equal<Extract<RpcResponse, { success: true }>["command"], RpcCommandType>>(true);

// ---------- 2. 文档示例 ----------

const usage = {
  input: 32000,
  output: 1200,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 33200,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
};

const model = {
  id: "claude-sonnet-4-20250514",
  name: "Claude Sonnet 4",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text", "image"],
  contextWindow: 200000,
  maxTokens: 16384,
  cost: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
} satisfies Model;

const image = { type: "image", data: "base64-encoded-data", mimeType: "image/png" } as const;

export const commands = [
  { id: "req-1", type: "prompt", message: "Hello, world!" },
  { type: "prompt", message: "What's in this image?", images: [image] },
  { type: "prompt", message: "New instruction", streamingBehavior: "steer" },
  { type: "steer", message: "Stop and do this instead" },
  { type: "steer", message: "Look at this instead", images: [image] },
  { type: "follow_up", message: "After you're done, also do this" },
  { type: "follow_up", message: "Also check this image", images: [image] },
  { type: "abort" },
  { type: "clear_queue" },
  { type: "new_session" },
  { type: "new_session", parentSession: "/path/to/parent-session.jsonl" },
  { type: "get_state" },
  { type: "get_messages" },
  { type: "set_model", provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
  { type: "cycle_model" },
  { type: "get_available_models" },
  { type: "set_thinking_level", level: "high" },
  { type: "cycle_thinking_level" },
  { type: "get_available_thinking_levels" },
  { type: "set_steering_mode", mode: "one-at-a-time" },
  { type: "set_follow_up_mode", mode: "one-at-a-time" },
  { type: "compact" },
  { type: "compact", customInstructions: "Focus on code changes" },
  { type: "set_auto_compaction", enabled: true },
  { type: "set_auto_retry", enabled: true },
  { type: "abort_retry" },
  { id: "req-1", type: "bash", command: "ls -la" },
  { type: "bash", command: "ls -la", excludeFromContext: true },
  { type: "abort_bash" },
  { type: "get_session_stats" },
  { type: "export_html" },
  { type: "export_html", outputPath: "/tmp/session.html" },
  { type: "switch_session", sessionPath: "/path/to/session.jsonl" },
  { type: "fork", entryId: "abc123" },
  { type: "clone" },
  { type: "get_fork_messages" },
  { type: "get_entries" },
  { type: "get_entries", since: "abc123" },
  { type: "get_tree" },
  { type: "get_last_assistant_text" },
  { type: "set_session_name", name: "my-feature-work" },
  { type: "get_commands" },
] satisfies RpcCommand[];

const assistant: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "Hi!" }],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  usage,
  stopReason: "stop",
  timestamp: 1733234402000,
};

export const responses = [
  {
    id: "req-1",
    type: "response",
    command: "prompt",
    success: true,
    data: { disposition: "started" },
  },
  { type: "response", command: "steer", success: true, data: { disposition: "queued" } },
  { type: "response", command: "follow_up", success: true, data: { disposition: "queued" } },
  { type: "response", command: "abort", success: true },
  {
    type: "response",
    command: "clear_queue",
    success: true,
    data: { steering: ["Change direction"], followUp: ["Summarize when finished"] },
  },
  { type: "response", command: "new_session", success: true, data: { cancelled: false } },
  {
    type: "response",
    command: "get_state",
    success: true,
    data: {
      model,
      thinkingLevel: "medium",
      isStreaming: false,
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "one-at-a-time",
      sessionFile: "/path/to/session.jsonl",
      sessionId: "abc123",
      sessionName: "my-feature-work",
      autoCompactionEnabled: true,
      messageCount: 5,
      pendingMessageCount: 0,
    },
  },
  { type: "response", command: "get_messages", success: true, data: { messages: [assistant] } },
  { type: "response", command: "set_model", success: true, data: model },
  {
    type: "response",
    command: "cycle_model",
    success: true,
    data: { model, thinkingLevel: "medium", isScoped: false },
  },
  { type: "response", command: "cycle_model", success: true, data: null },
  { type: "response", command: "get_available_models", success: true, data: { models: [model] } },
  { type: "response", command: "set_thinking_level", success: true },
  { type: "response", command: "cycle_thinking_level", success: true, data: { level: "high" } },
  {
    type: "response",
    command: "get_available_thinking_levels",
    success: true,
    data: { levels: ["off", "minimal", "low", "medium", "high"] },
  },
  { type: "response", command: "set_steering_mode", success: true },
  { type: "response", command: "set_follow_up_mode", success: true },
  {
    type: "response",
    command: "compact",
    success: true,
    data: {
      summary: "Summary of conversation...",
      firstKeptEntryId: "abc123",
      tokensBefore: 150000,
      estimatedTokensAfter: 32000,
      usage,
      details: {},
    },
  },
  { type: "response", command: "set_auto_compaction", success: true },
  { type: "response", command: "set_auto_retry", success: true },
  { type: "response", command: "abort_retry", success: true },
  {
    id: "req-1",
    type: "response",
    command: "bash",
    success: true,
    data: { output: "total 48\ndrwxr-xr-x ...", exitCode: 0, cancelled: false, truncated: false },
  },
  {
    type: "response",
    command: "bash",
    success: true,
    data: {
      output: "truncated output...",
      exitCode: 0,
      cancelled: false,
      truncated: true,
      fullOutputPath: "/tmp/bash-abc123.log",
    },
  },
  { type: "response", command: "abort_bash", success: true },
  {
    type: "response",
    command: "get_session_stats",
    success: true,
    data: {
      sessionFile: "/path/to/session.jsonl",
      sessionId: "abc123",
      userMessages: 5,
      assistantMessages: 5,
      toolCalls: 12,
      toolResults: 12,
      totalMessages: 22,
      tokens: { input: 50000, output: 10000, cacheRead: 40000, cacheWrite: 5000, total: 105000 },
      cost: 0.45,
      contextUsage: { tokens: 60000, contextWindow: 200000, percent: 30 },
    },
  },
  { type: "response", command: "export_html", success: true, data: { path: "/tmp/session.html" } },
  { type: "response", command: "switch_session", success: true, data: { cancelled: true } },
  {
    type: "response",
    command: "fork",
    success: true,
    data: { text: "The original prompt text...", cancelled: false },
  },
  { type: "response", command: "fork", success: true, data: { cancelled: true } },
  { type: "response", command: "clone", success: true, data: { cancelled: false } },
  {
    type: "response",
    command: "get_fork_messages",
    success: true,
    data: {
      messages: [
        { entryId: "abc123", text: "First prompt..." },
        { entryId: "def456", text: "Second prompt..." },
      ],
    },
  },
  {
    type: "response",
    command: "get_entries",
    success: true,
    data: {
      entries: [
        {
          type: "message",
          id: "def456",
          parentId: "abc123",
          timestamp: "2024-12-03T14:00:01.000Z",
          message: { role: "user", content: "Hello", timestamp: 1733234401000 },
        },
      ],
      leafId: "def456",
    },
  },
  {
    type: "response",
    command: "get_last_assistant_text",
    success: true,
    data: { text: "The assistant's response..." },
  },
  { type: "response", command: "set_session_name", success: true },
  {
    type: "response",
    command: "get_commands",
    success: true,
    data: {
      commands: [
        {
          name: "fix-tests",
          description: "Fix failing tests",
          source: "prompt",
          sourceInfo: {
            path: "/home/user/myproject/.primus/agent/prompts/fix-tests.md",
            source: "local",
            scope: "project",
            origin: "top-level",
          },
        },
      ],
    },
  },
  {
    id: "req-3",
    type: "response",
    command: "set_model",
    success: false,
    error: "Model not found: invalid/model",
  },
  {
    type: "response",
    command: "parse",
    success: false,
    error: "Failed to parse command: Unexpected token...",
  },
] satisfies RpcResponse[];

export const tree = [
  {
    entry: {
      type: "message",
      id: "abc123",
      parentId: null,
      timestamp: "2024-12-03T14:00:00.000Z",
      message: assistant,
    },
    children: [],
  },
] satisfies SessionTreeNode[];

export const getTree: RpcResponseFor<"get_tree"> = {
  type: "response",
  command: "get_tree",
  success: true,
  data: { tree, leafId: "abc123" },
};

export const events = [
  { type: "agent_start" },
  { type: "turn_start" },
  {
    type: "message_start",
    message: { role: "user", content: "Review this repository", timestamp: 1733234401000 },
  },
  {
    type: "message_end",
    message: { role: "user", content: "Review this repository", timestamp: 1733234401000 },
  },
  { type: "message_start", message: { ...assistant, content: [], stopReason: "pending" } },
  {
    type: "message_update",
    usage,
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello " },
  },
  {
    type: "message_update",
    usage,
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 1,
      id: "call_abc123",
      toolName: "bash",
    },
  },
  { type: "message_end", message: assistant },
  { type: "turn_end", message: assistant, toolResults: [] },
  { type: "agent_end", messages: [assistant], willRetry: false },
  { type: "agent_settled", aborted: false },
  {
    type: "tool_execution_start",
    toolCallId: "call_abc123",
    toolName: "bash",
    args: { command: "ls -la" },
  },
  {
    type: "tool_execution_update",
    toolCallId: "call_abc123",
    toolName: "bash",
    args: { command: "ls -la" },
    partialResult: { content: [{ type: "text", text: "partial output" }], details: {} },
  },
  {
    type: "tool_execution_end",
    toolCallId: "call_abc123",
    toolName: "bash",
    result: { content: [{ type: "text", text: "complete output" }], details: {} },
    isError: false,
  },
  { type: "queue_update", steering: [], followUp: ["Summarize when finished"] },
  {
    type: "entry_appended",
    entry: {
      type: "custom",
      id: "h8i9j0k1",
      parentId: "g7h8i9j0",
      timestamp: "2024-12-03T14:20:00.000Z",
      customType: "my-extension",
      data: { count: 42 },
    },
  },
  { type: "session_info_changed", name: "Refactor auth module" },
  { type: "session_info_changed" },
  { type: "thinking_level_changed", level: "high" },
  { type: "compaction_start", reason: "threshold" },
  {
    type: "compaction_end",
    reason: "threshold",
    result: {
      summary: "Summary of conversation...",
      firstKeptEntryId: "abc123",
      tokensBefore: 150000,
      estimatedTokensAfter: 32000,
      usage,
      details: {},
    },
    aborted: false,
    willRetry: false,
  },
  {
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 3,
    delayMs: 2000,
    errorMessage: "529 overloaded",
  },
  { type: "auto_retry_end", success: true, attempt: 2 },
  { type: "auto_retry_end", success: false, attempt: 3, finalError: "529 overloaded" },
  {
    type: "summarization_retry_scheduled",
    attempt: 1,
    maxAttempts: 3,
    delayMs: 2000,
    errorMessage: "terminated",
  },
  { type: "summarization_retry_attempt_start", source: "compaction", reason: "threshold" },
  { type: "summarization_retry_attempt_start", source: "branchSummary" },
  { type: "summarization_retry_finished" },
  { type: "bash_execution_update", id: "req-1", delta: "total 48\n" },
] satisfies SessionEvent[];

export const uiRequests = [
  {
    type: "extension_ui_request",
    id: "uuid-1",
    method: "select",
    title: "Allow dangerous command?",
    options: ["Allow", "Block"],
    timeout: 10000,
  },
  {
    type: "extension_ui_request",
    id: "uuid-2",
    method: "confirm",
    title: "Clear session?",
    message: "All messages will be lost.",
    timeout: 5000,
  },
  {
    type: "extension_ui_request",
    id: "uuid-3",
    method: "input",
    title: "Enter a value",
    placeholder: "type something...",
  },
  {
    type: "extension_ui_request",
    id: "uuid-4",
    method: "editor",
    title: "Edit some text",
    prefill: "Line 1\nLine 2\nLine 3",
  },
  {
    type: "extension_ui_request",
    id: "uuid-5",
    method: "notify",
    message: "Command blocked by user",
    notifyType: "warning",
  },
  {
    type: "extension_ui_request",
    id: "uuid-6",
    method: "setStatus",
    statusKey: "my-ext",
    statusText: "Turn 3 running...",
  },
  { type: "extension_ui_request", id: "uuid-6b", method: "setStatus", statusKey: "my-ext" },
  {
    type: "extension_ui_request",
    id: "uuid-7",
    method: "setWidget",
    widgetKey: "my-ext",
    widgetLines: ["--- My Widget ---", "Line 1", "Line 2"],
    widgetPlacement: "aboveEditor",
  },
  { type: "extension_ui_request", id: "uuid-8", method: "setTitle", title: "Primus - my project" },
  {
    type: "extension_ui_request",
    id: "uuid-9",
    method: "set_editor_text",
    text: "prefilled text for the user",
  },
] satisfies ExtensionUiRequest[];

export const uiResponses = [
  { type: "extension_ui_response", id: "uuid-1", value: "Allow" },
  { type: "extension_ui_response", id: "uuid-2", confirmed: true },
  { type: "extension_ui_response", id: "uuid-3", cancelled: true },
] satisfies ExtensionUiResponse[];

export const extensionError = {
  type: "extension_error",
  extensionPath: "/path/to/extension.ts",
  event: "tool_call",
  error: "Error message",
} satisfies CoreRecord;

export const entries = [
  {
    type: "message",
    id: "a0b1c2d3",
    parentId: null,
    timestamp: "2024-12-03T14:00:00.000Z",
    message: {
      role: "system",
      content: "",
      sections: { preamble: "You are an expert coding assistant...", cwd: "/project" },
      toolsAdded: [{ name: "read", description: "...", parameters: {} }],
      timestamp: 1733234400000,
    },
  },
  {
    type: "message",
    id: "d4e5f6g7",
    parentId: "c3d4e5f6",
    timestamp: "2024-12-03T14:04:00.000Z",
    message: {
      role: "system",
      content: "",
      sections: { skills: "<skills>...</skills>" },
      toolsRemoved: [{ name: "write" }],
      timestamp: 1733234640000,
    },
  },
  {
    type: "message",
    id: "c3d4e5f6",
    parentId: "b2c3d4e5",
    timestamp: "2024-12-03T14:00:03.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call_123",
      toolName: "bash",
      content: [{ type: "text", text: "output" }],
      isError: false,
      timestamp: 1733234403000,
    },
  },
  {
    type: "model_change",
    id: "d4e5f6g7",
    parentId: "c3d4e5f6",
    timestamp: "2024-12-03T14:05:00.000Z",
    provider: "openai",
    modelId: "gpt-4o",
  },
  {
    type: "thinking_level_change",
    id: "e5f6g7h8",
    parentId: "d4e5f6g7",
    timestamp: "2024-12-03T14:06:00.000Z",
    thinkingLevel: "high",
  },
  {
    type: "usage",
    id: "f6g7h8i9",
    parentId: "e5f6g7h8",
    timestamp: "2024-12-03T14:08:00.000Z",
    kind: "cache_warm",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage,
  },
  {
    type: "compaction",
    id: "f6g7h8i9",
    parentId: "e5f6g7h8",
    timestamp: "2024-12-03T14:10:00.000Z",
    summary: "User discussed X, Y, Z...",
    firstKeptEntryId: "c3d4e5f6",
    tokensBefore: 50000,
    systemMessage: {
      role: "system",
      content: "You are a coding assistant.",
      toolsAdded: [],
      timestamp: 1733235000000,
    },
  },
  {
    type: "context_edit",
    id: "g6h7i8j9",
    parentId: "f6g7h8i9",
    timestamp: "2024-12-03T14:11:00.000Z",
    targetId: "c3d4e5f6",
    replacement: null,
  },
  {
    type: "branch_summary",
    id: "g7h8i9j0",
    parentId: "a1b2c3d4",
    timestamp: "2024-12-03T14:15:00.000Z",
    fromId: "f6g7h8i9",
    summary: "Branch explored approach A...",
  },
  {
    type: "custom_message",
    id: "i9j0k1l2",
    parentId: "h8i9j0k1",
    timestamp: "2024-12-03T14:25:00.000Z",
    customType: "my-extension",
    content: "Injected context...",
    display: true,
  },
  {
    type: "label",
    id: "j0k1l2m3",
    parentId: "i9j0k1l2",
    timestamp: "2024-12-03T14:30:00.000Z",
    targetId: "a1b2c3d4",
    label: "checkpoint-1",
  },
  {
    type: "session_info",
    id: "k1l2m3n4",
    parentId: "j0k1l2m3",
    timestamp: "2024-12-03T14:35:00.000Z",
    name: "Refactor auth module",
  },
] satisfies SessionEntry[];
