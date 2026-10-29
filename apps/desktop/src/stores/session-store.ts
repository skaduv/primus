import type {
  AgentMessage,
  AssistantContent,
  AssistantMessageEvent,
  CoreRecord,
  RpcResponse,
  ToolResult,
} from "@primus/protocol";
import { produce } from "immer";
import { createStore } from "zustand/vanilla";

// 每会话 store（第 16.4 节）：按顺序合并 RPC 客户端交付的记录，按第 7.4 节重建流式消息。

/** 流式中的工具调用块：参数 JSON 尚未完整时先累积原始文本 */
export interface StreamingToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  argsText?: string;
}

export type TimelineContent = AssistantContent | StreamingToolCall;

export interface ToolRun {
  toolCallId: string;
  toolName: string;
  status: "running" | "done" | "error";
  result?: ToolResult;
}

export interface SessionState {
  /** RPC 客户端发现批次缺口，正在用 get_messages + get_state 重建；收到 get_messages 结果后清除 */
  needsResync: boolean;
  /** 时间线消息；最后一条可能仍在流式输出 */
  messages: AgentMessage[];
  /** 当前是否有消息在流式输出（message_start 到 message_end 之间） */
  streamingMessage: boolean;
  /** agent_start 到 agent_settled 之间为 true，期间锁定输入 */
  running: boolean;
  toolRuns: Record<string, ToolRun>;
  /** 最近一次失败的命令响应 */
  lastError?: string;
}

export const initialSessionState: SessionState = {
  needsResync: false,
  messages: [],
  streamingMessage: false,
  running: false,
  toolRuns: {},
};

function applyUpdate(content: TimelineContent[], e: AssistantMessageEvent): void {
  // start / done / error 不作用于内容块（正常运行中由 message_start / message_end 承担）
  if (!("contentIndex" in e)) return;
  const i = e.contentIndex;
  switch (e.type) {
    case "text_start":
      content[i] = { type: "text", text: "" };
      return;
    case "thinking_start":
      content[i] = { type: "thinking", thinking: "" };
      return;
    case "toolcall_start":
      content[i] = { type: "toolCall", id: e.id, name: e.toolName, arguments: {}, argsText: "" };
      return;
    case "text_delta": {
      const block = content[i];
      if (block?.type === "text") block.text += e.delta;
      else content[i] = { type: "text", text: e.delta };
      return;
    }
    case "thinking_delta": {
      const block = content[i];
      if (block?.type === "thinking") block.thinking += e.delta;
      else content[i] = { type: "thinking", thinking: e.delta };
      return;
    }
    case "toolcall_delta": {
      const block = content[i];
      if (block?.type === "toolCall") {
        const call = block as StreamingToolCall;
        call.argsText = (call.argsText ?? "") + e.delta;
      }
      return;
    }
    // *_end 携带完整内容，替换累积结果
    case "text_end":
      content[i] = { type: "text", text: e.content };
      return;
    case "thinking_end":
      content[i] = { type: "thinking", thinking: e.content };
      return;
    case "toolcall_end":
      content[i] = e.toolCall;
      return;
  }
}

function applyRecord(draft: SessionState, record: CoreRecord): void {
  switch (record.type) {
    case "response": {
      const r: RpcResponse = record;
      if (!r.success) {
        draft.lastError = r.error || `${r.command} 失败`;
        return;
      }
      // get_messages 的结果是权威历史：用于打开已有会话和缺号后的重建。
      // 它不含正在流式输出的消息，因此结束流式状态：之后的增量在下一个 message_start 前忽略，
      // 那条消息由它的 message_end 补上。
      if (r.command === "get_messages" && Array.isArray(r.data?.messages)) {
        draft.messages = r.data.messages;
        draft.streamingMessage = false;
        draft.needsResync = false;
      }
      // get_state 校正运行状态（缺号时可能错过了 agent_start / agent_settled）
      if (r.command === "get_state" && r.data) {
        draft.running = r.data.isStreaming || r.data.isCompacting;
      }
      return;
    }
    case "agent_start":
      draft.running = true;
      draft.lastError = undefined;
      return;
    case "agent_settled":
      draft.running = false;
      draft.streamingMessage = false;
      return;
    case "message_start": {
      const { message } = record as { message: AgentMessage };
      const copy = { ...message } as AgentMessage & { content?: unknown };
      if (Array.isArray(copy.content)) copy.content = [...copy.content];
      draft.messages.push(copy);
      draft.streamingMessage = true;
      return;
    }
    case "message_update": {
      const { assistantMessageEvent } = record as { assistantMessageEvent: AssistantMessageEvent };
      if (!draft.streamingMessage) return;
      const last = draft.messages.at(-1) as { role: string; content?: unknown } | undefined;
      if (last?.role !== "assistant" || !Array.isArray(last.content)) return;
      applyUpdate(last.content as TimelineContent[], assistantMessageEvent);
      return;
    }
    case "message_end": {
      // message_end 是权威的最终版本，整条替换
      const { message } = record as { message: AgentMessage };
      if (draft.streamingMessage && draft.messages.length > 0)
        draft.messages[draft.messages.length - 1] = message;
      else draft.messages.push(message);
      draft.streamingMessage = false;
      return;
    }
    case "tool_execution_start": {
      const r = record as { toolCallId: string; toolName: string };
      draft.toolRuns[r.toolCallId] = {
        toolCallId: r.toolCallId,
        toolName: r.toolName,
        status: "running",
      };
      return;
    }
    case "tool_execution_update": {
      const r = record as { toolCallId: string; partialResult: ToolResult };
      const run = draft.toolRuns[r.toolCallId];
      if (run) run.result = r.partialResult;
      return;
    }
    case "tool_execution_end": {
      const r = record as { toolCallId: string; result: ToolResult; isError: boolean };
      const run = draft.toolRuns[r.toolCallId];
      if (run) {
        run.result = r.result;
        run.status = r.isError ? "error" : "done";
      }
      return;
    }
    default:
      // 其余事件（queue_update、compaction_* 等）由后续功能处理
      return;
  }
}

/** RPC 客户端交付的一段记录（一个批次去重后的内容） */
export interface RecordChunk {
  records: readonly CoreRecord[];
  /** 这段之前有记录丢失：标记重建，由 RPC 客户端发出 get_messages + get_state */
  gap: boolean;
}

/** 按顺序合并若干段记录（纯函数）。批次去重与缺口检测由 RPC 客户端负责（src/rpc） */
export function applyChunks(state: SessionState, chunks: readonly RecordChunk[]): SessionState {
  return produce(state, (draft) => {
    for (const chunk of chunks) {
      if (chunk.gap) draft.needsResync = true;
      for (const record of chunk.records) applyRecord(draft, record);
    }
  });
}

export type SessionStore = ReturnType<typeof createSessionStore>;

/** 为一个打开的会话创建独立 store；关闭会话时丢弃即可 */
export function createSessionStore() {
  return createStore<SessionState>()(() => initialSessionState);
}
