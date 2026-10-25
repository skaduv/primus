import type { CoreBatch, CoreRecord } from "@primus/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../types";
import { createMockPlatform } from "./index";
import { chunk, promptScenario } from "./scenario";

const types = (records: CoreRecord[]) => records.map((r) => r.type);

describe("mock 平台", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("实现了附录 B 的全部命令", () => {
    const platform = createMockPlatform();
    expect(Object.keys(platform).sort()).toEqual(Object.keys(COMMANDS).sort());
  });

  it("prompt 先回 response，再按 16ms 一批推送完整事件流，seq 连续", async () => {
    const platform = createMockPlatform({ batchSize: 5, now: () => 1000 });
    const batches: CoreBatch[] = [];
    const { sessionKey } = await platform.sessionOpen("ws", undefined, (b) => batches.push(b));
    await platform.coreSend(sessionKey, { id: `${sessionKey}-1`, type: "prompt", message: "你好" });

    expect(batches).toHaveLength(0); // 异步推送
    await vi.advanceTimersByTimeAsync(16);
    expect(batches).toHaveLength(1);
    await vi.runAllTimersAsync();

    expect(batches.map((b) => b.seq)).toEqual(batches.map((_, i) => i + 1));
    expect(batches.every((b) => b.sessionKey === sessionKey && b.dropped === 0)).toBe(true);
    const records = batches.flatMap((b) => b.records);
    expect(records[0]).toMatchObject({
      type: "response",
      id: `${sessionKey}-1`,
      command: "prompt",
      success: true,
      data: { disposition: "started" },
    });
    expect(types(records).slice(1, 3)).toEqual(["agent_start", "turn_start"]);
    expect(types(records).slice(-2)).toEqual(["agent_end", "agent_settled"]);
  });

  it("运行中再次 prompt 返回失败响应；abort 丢弃剩余事件并以 aborted 结束", async () => {
    const platform = createMockPlatform({ batchSize: 3 });
    const records: CoreRecord[] = [];
    const { sessionKey } = await platform.sessionOpen("ws", undefined, (b) =>
      records.push(...b.records),
    );
    await platform.coreSend(sessionKey, { id: "a-1", type: "prompt", message: "一" });
    await vi.advanceTimersByTimeAsync(16);
    await platform.coreSend(sessionKey, { id: "a-2", type: "prompt", message: "二" });
    await platform.coreSend(sessionKey, { id: "a-3", type: "abort" });
    await vi.runAllTimersAsync();

    expect(records.find((r) => "id" in r && r.id === "a-2")).toMatchObject({ success: false });
    expect(records.find((r) => "id" in r && r.id === "a-3")).toMatchObject({ success: true });
    expect(records.at(-1)).toEqual({ type: "agent_settled", aborted: true });
    expect(types(records)).not.toContain("turn_end");

    // 结束后可以再次发送
    records.length = 0;
    await platform.coreSend(sessionKey, { id: "a-4", type: "prompt", message: "三" });
    await vi.runAllTimersAsync();
    expect(records[0]).toMatchObject({ id: "a-4", success: true });
  });

  it("get_messages 返回已发生的消息；未实现的命令返回失败响应", async () => {
    const platform = createMockPlatform({ batchSize: 100 });
    const records: CoreRecord[] = [];
    const { sessionKey } = await platform.sessionOpen("ws", undefined, (b) =>
      records.push(...b.records),
    );
    await platform.coreSend(sessionKey, { id: "m-1", type: "prompt", message: "hi" });
    await vi.runAllTimersAsync();
    await platform.coreSend(sessionKey, { id: "m-2", type: "get_messages" });
    await platform.coreSend(sessionKey, { id: "m-3", type: "export_html" });
    await vi.runAllTimersAsync();

    const got = records.find((r) => "id" in r && r.id === "m-2") as {
      data: { messages: Array<{ role: string }> };
    };
    expect(got.data.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(records.find((r) => "id" in r && r.id === "m-3")).toMatchObject({ success: false });
  });

  it("关闭会话后不再推送，也不能再发送", async () => {
    const platform = createMockPlatform();
    const onBatch = vi.fn();
    const { sessionKey } = await platform.sessionOpen("ws", undefined, onBatch);
    await platform.coreSend(sessionKey, { id: "c-1", type: "prompt", message: "x" });
    await platform.sessionClose(sessionKey);
    await vi.runAllTimersAsync();
    expect(onBatch).not.toHaveBeenCalled();
    await expect(platform.coreSend(sessionKey, { id: "c-2", type: "get_state" })).rejects.toThrow();
  });
});

describe("假事件流脚本", () => {
  it("按码点切分，不拆开代理对", () => {
    expect(chunk("ab😀cd", 3)).toEqual(["ab😀", "cd"]);
  });

  it("每个 *_delta 之前有 *_start、之后有携带完整内容的 *_end", () => {
    const { records } = promptScenario("测试", 0);
    const updates = records
      .filter((r) => r.type === "message_update")
      .map((r) => (r as { assistantMessageEvent: { type: string } }).assistantMessageEvent.type);
    expect(updates[0]).toBe("thinking_start");
    expect(updates).toContain("toolcall_end");
    expect(updates.at(-1)).toBe("text_end");
  });
});
