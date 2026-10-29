import type { AgentMessage, CoreRecord } from "@primus/protocol";
import { describe, expect, it } from "vitest";
import { promptScenario, usage } from "@/lib/platform/mock/scenario";
import { applyChunks, initialSessionState, type RecordChunk } from "./session-store";

const chunk = (records: CoreRecord[], gap = false): RecordChunk => ({ records, gap });
const u = usage(1, 1);
/** 测试只关心部分字段的消息 */
const msg = (m: Record<string, unknown>) => m as unknown as AgentMessage;
const update = (assistantMessageEvent: unknown): CoreRecord =>
  ({ type: "message_update", usage: u, assistantMessageEvent }) as CoreRecord;

describe("会话 store：流式消息重建（第 7.4 节）", () => {
  it("增量按 contentIndex 追加，*_end 用完整内容替换", () => {
    const s = applyChunks(initialSessionState, [
      chunk([
        { type: "agent_start" },
        { type: "message_start", message: msg({ role: "assistant", content: [] }) },
        update({ type: "text_start", contentIndex: 0 }),
        update({ type: "text_delta", contentIndex: 0, delta: "你" }),
        update({ type: "text_delta", contentIndex: 0, delta: "好" }),
      ]),
    ]);
    expect(s.running).toBe(true);
    expect(s.streamingMessage).toBe(true);
    expect(s.messages[0]).toMatchObject({ content: [{ type: "text", text: "你好" }] });

    const s2 = applyChunks(s, [
      chunk([update({ type: "text_end", contentIndex: 0, content: "你好！" })]),
    ]);
    expect(s2.messages[0]).toMatchObject({ content: [{ type: "text", text: "你好！" }] });
    // 不可变更新：旧状态不受影响
    expect(s.messages[0]).toMatchObject({ content: [{ type: "text", text: "你好" }] });
  });

  it("message_end 整条替换为最终版本；agent_settled 才解锁", () => {
    const final = msg({
      role: "assistant",
      content: [{ type: "text", text: "最终" }],
      stopReason: "stop",
    });
    const s = applyChunks(initialSessionState, [
      chunk([
        { type: "agent_start" },
        { type: "message_start", message: msg({ role: "assistant", content: [] }) },
        update({ type: "text_delta", contentIndex: 0, delta: "草稿" }),
        { type: "message_end", message: final },
        { type: "agent_end", messages: [], willRetry: false },
      ]),
    ]);
    expect(s.messages).toEqual([final]);
    expect(s.streamingMessage).toBe(false);
    expect(s.running).toBe(true); // agent_end 之后仍可能重试或压缩
    expect(applyChunks(s, [chunk([{ type: "agent_settled", aborted: false }])]).running).toBe(
      false,
    );
  });

  it("完整的 mock 事件流重建出与 get_messages 一致的消息", () => {
    const { records, messages } = promptScenario("你好", 0);
    const batches: RecordChunk[] = [];
    for (let i = 0; i < records.length; i += 7) batches.push(chunk(records.slice(i, i + 7)));
    const s = applyChunks(initialSessionState, batches);
    expect(s.messages).toEqual(messages);
    expect(s.running).toBe(false);
    expect(Object.values(s.toolRuns)).toMatchObject([{ toolName: "read", status: "done" }]);
  });

  it("工具调用参数流式期间累积原始文本，结束时替换为完整调用", () => {
    const s = applyChunks(initialSessionState, [
      chunk([
        { type: "message_start", message: msg({ role: "assistant", content: [] }) },
        update({ type: "toolcall_start", contentIndex: 0, id: "c1", toolName: "read" }),
        update({ type: "toolcall_delta", contentIndex: 0, delta: '{"path":' }),
      ]),
    ]);
    expect(s.messages[0]).toMatchObject({ content: [{ type: "toolCall", argsText: '{"path":' }] });
    const call = { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } };
    const s2 = applyChunks(s, [
      chunk([update({ type: "toolcall_end", contentIndex: 0, toolCall: call })]),
    ]);
    expect(s2.messages[0]).toMatchObject({ content: [call] });
  });

  it("缺口标记重建；get_messages 覆盖历史并结束流式，get_state 校正运行状态", () => {
    const s1 = applyChunks(initialSessionState, [
      chunk([
        { type: "agent_start" },
        { type: "message_start", message: msg({ role: "assistant", content: [] }) },
      ]),
    ]);
    // 丢了一段：其中有 message_end 与 agent_settled
    const gap = applyChunks(s1, [chunk([], true)]);
    expect(gap.needsResync).toBe(true);

    const history: AgentMessage[] = [{ role: "user", content: "hi", timestamp: 1 }];
    const fixed = applyChunks(gap, [
      chunk([
        {
          type: "response",
          id: "s-9",
          command: "get_messages",
          success: true,
          data: { messages: history },
        },
        // 流式中的旧消息已不在历史里：增量在下一个 message_start 前忽略
        update({ type: "text_delta", contentIndex: 0, delta: "迟到" }),
        {
          type: "response",
          id: "s-10",
          command: "get_state",
          success: true,
          data: {
            thinkingLevel: "off",
            isStreaming: false,
            isCompacting: false,
            steeringMode: "one-at-a-time",
            followUpMode: "one-at-a-time",
            sessionId: "x",
            autoCompactionEnabled: true,
            messageCount: 1,
            pendingMessageCount: 0,
          },
        },
      ]),
    ]);
    expect(fixed.needsResync).toBe(false);
    expect(fixed.messages).toEqual(history);
    expect(fixed.streamingMessage).toBe(false);
    expect(fixed.running).toBe(false);
  });

  it("失败响应记入 lastError，新一轮开始时清除", () => {
    const s = applyChunks(initialSessionState, [
      chunk([{ type: "response", id: "x", command: "prompt", success: false, error: "忙" }]),
    ]);
    expect(s.lastError).toBe("忙");
    expect(applyChunks(s, [chunk([{ type: "agent_start" }])]).lastError).toBeUndefined();
  });
});
