import type { CoreBatch, CoreRecord } from "@primus/protocol";
import { describe, expect, it } from "vitest";
import { promptScenario, usage } from "@/lib/platform/mock/scenario";
import { applyBatches, initialSessionState } from "./session-store";

const batch = (seq: number, records: CoreRecord[], dropped = 0): CoreBatch => ({
  sessionKey: "s",
  seq,
  records,
  dropped,
});
const u = usage(1, 1);
const update = (assistantMessageEvent: unknown): CoreRecord =>
  ({ type: "message_update", usage: u, assistantMessageEvent }) as CoreRecord;

describe("会话 store：流式消息重建（第 7.4 节）", () => {
  it("增量按 contentIndex 追加，*_end 用完整内容替换", () => {
    const s = applyBatches(initialSessionState, [
      batch(1, [
        { type: "agent_start" },
        { type: "message_start", message: { role: "assistant", content: [] } },
        update({ type: "text_start", contentIndex: 0 }),
        update({ type: "text_delta", contentIndex: 0, delta: "你" }),
        update({ type: "text_delta", contentIndex: 0, delta: "好" }),
      ]),
    ]);
    expect(s.running).toBe(true);
    expect(s.streamingMessage).toBe(true);
    expect(s.messages[0]).toMatchObject({ content: [{ type: "text", text: "你好" }] });

    const s2 = applyBatches(s, [
      batch(2, [update({ type: "text_end", contentIndex: 0, content: "你好！" })]),
    ]);
    expect(s2.messages[0]).toMatchObject({ content: [{ type: "text", text: "你好！" }] });
    // 不可变更新：旧状态不受影响
    expect(s.messages[0]).toMatchObject({ content: [{ type: "text", text: "你好" }] });
  });

  it("message_end 整条替换为最终版本；agent_settled 才解锁", () => {
    const final = {
      role: "assistant",
      content: [{ type: "text", text: "最终" }],
      stopReason: "stop",
    };
    const s = applyBatches(initialSessionState, [
      batch(1, [
        { type: "agent_start" },
        { type: "message_start", message: { role: "assistant", content: [] } },
        update({ type: "text_delta", contentIndex: 0, delta: "草稿" }),
        { type: "message_end", message: final },
        { type: "agent_end", messages: [], willRetry: false },
      ]),
    ]);
    expect(s.messages).toEqual([final]);
    expect(s.streamingMessage).toBe(false);
    expect(s.running).toBe(true); // agent_end 之后仍可能重试或压缩
    expect(applyBatches(s, [batch(2, [{ type: "agent_settled", aborted: false }])]).running).toBe(
      false,
    );
  });

  it("完整的 mock 事件流重建出与 get_messages 一致的消息", () => {
    const { records, messages } = promptScenario("你好", 0);
    const batches = [];
    for (let i = 0; i < records.length; i += 7)
      batches.push(batch(batches.length + 1, records.slice(i, i + 7)));
    const s = applyBatches(initialSessionState, batches);
    expect(s.messages).toEqual(messages);
    expect(s.running).toBe(false);
    expect(Object.values(s.toolRuns)).toMatchObject([{ toolName: "read", status: "done" }]);
  });

  it("工具调用参数流式期间累积原始文本，结束时替换为完整调用", () => {
    const s = applyBatches(initialSessionState, [
      batch(1, [
        { type: "message_start", message: { role: "assistant", content: [] } },
        update({ type: "toolcall_start", contentIndex: 0, id: "c1", toolName: "read" }),
        update({ type: "toolcall_delta", contentIndex: 0, delta: '{"path":' }),
      ]),
    ]);
    expect(s.messages[0]).toMatchObject({ content: [{ type: "toolCall", argsText: '{"path":' }] });
    const call = { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } };
    const s2 = applyBatches(s, [
      batch(2, [update({ type: "toolcall_end", contentIndex: 0, toolCall: call })]),
    ]);
    expect(s2.messages[0]).toMatchObject({ content: [call] });
  });

  it("重复批次忽略；缺号或丢弃时标记重建，get_messages 响应后清除", () => {
    const s1 = applyBatches(initialSessionState, [batch(1, [{ type: "agent_start" }])]);
    expect(applyBatches(s1, [batch(1, [{ type: "agent_settled", aborted: false }])])).toBe(s1);

    const gap = applyBatches(s1, [batch(3, [])]);
    expect(gap.needsResync).toBe(true);
    expect(gap.seq).toBe(3);
    expect(applyBatches(s1, [batch(2, [], 5)]).needsResync).toBe(true);

    const history = [{ role: "user", content: "hi", timestamp: 1 }];
    const fixed = applyBatches(gap, [
      batch(4, [
        {
          type: "response",
          id: "s-9",
          command: "get_messages",
          success: true,
          data: { messages: history },
        },
      ]),
    ]);
    expect(fixed.needsResync).toBe(false);
    expect(fixed.messages).toEqual(history);
  });

  it("失败响应记入 lastError，新一轮开始时清除", () => {
    const s = applyBatches(initialSessionState, [
      batch(1, [{ type: "response", id: "x", command: "prompt", success: false, error: "忙" }]),
    ]);
    expect(s.lastError).toBe("忙");
    expect(applyBatches(s, [batch(2, [{ type: "agent_start" }])]).lastError).toBeUndefined();
  });
});
