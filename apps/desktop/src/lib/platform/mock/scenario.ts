import type { AgentMessage, AssistantMessage, CoreRecord, Usage } from "@primus/protocol";

// 脚本化的假 Core 事件流：按 Core JSON 事件流规范（json.md）生成一轮完整运行，
// 包含思考、文本流式输出、一次工具调用与工具结果、第二轮回答，最后 agent_end + agent_settled。

const MODEL = { provider: "mock", model: "mock-model", api: "mock" };

export function usage(input: number, output: number): Usage {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** 把文本切成若干增量片段，模拟流式输出 */
export function chunk(text: string, size = 6): string[] {
  const parts: string[] = [];
  const chars = Array.from(text); // 按码点切分，不拆开代理对
  for (let i = 0; i < chars.length; i += size) parts.push(chars.slice(i, i + size).join(""));
  return parts;
}

function streamText(
  records: CoreRecord[],
  kind: "text" | "thinking",
  contentIndex: number,
  text: string,
  u: Usage,
): void {
  records.push({
    type: "message_update",
    usage: u,
    assistantMessageEvent: { type: `${kind}_start`, contentIndex },
  });
  for (const delta of chunk(text)) {
    records.push({
      type: "message_update",
      usage: u,
      assistantMessageEvent: { type: `${kind}_delta`, contentIndex, delta },
    });
  }
  records.push({
    type: "message_update",
    usage: u,
    assistantMessageEvent: { type: `${kind}_end`, contentIndex, content: text },
  });
}

export interface ScenarioResult {
  records: CoreRecord[];
  /** 本轮新增的消息（供 get_messages 使用） */
  messages: AgentMessage[];
}

/** 为一次 prompt 生成完整事件序列 */
export function promptScenario(prompt: string, now: number): ScenarioResult {
  const records: CoreRecord[] = [];
  const messages: AgentMessage[] = [];
  const toolCallId = `call_mock_${now}`;
  const thinking = "用户发来了一条消息。先看看工作区里有什么，再回答。";
  const firstText = "我先查看一下工作区的文件。";
  const toolArgs = { path: "README.md" };
  const toolOutput = "# 示例工作区\n\n这是 mock 平台返回的假文件内容。";
  const answer = `这是来自 **mock 平台**的模拟回答（浏览器预览模式，没有连接真实内核）。\n\n你刚才说：「${prompt}」\n\n工作区里有一个 README.md，内容是示例文本。`;

  const user: AgentMessage = { role: "user", content: prompt, timestamp: now };
  messages.push(user);
  records.push({ type: "agent_start" }, { type: "turn_start" });
  records.push({ type: "message_start", message: user }, { type: "message_end", message: user });

  // 第一轮：思考 + 文本 + 工具调用
  const u1 = usage(120, 40);
  const first: AssistantMessage = {
    role: "assistant",
    content: [
      { type: "thinking", thinking },
      { type: "text", text: firstText },
      { type: "toolCall", id: toolCallId, name: "read", arguments: toolArgs },
    ],
    stopReason: "toolUse",
    usage: u1,
    timestamp: now + 1,
    ...MODEL,
  };
  records.push({
    type: "message_start",
    message: { ...first, content: [], stopReason: "pending" },
  });
  streamText(records, "thinking", 0, thinking, u1);
  streamText(records, "text", 1, firstText, u1);
  records.push({
    type: "message_update",
    usage: u1,
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 2,
      id: toolCallId,
      toolName: "read",
    },
  });
  for (const delta of chunk(JSON.stringify(toolArgs), 8)) {
    records.push({
      type: "message_update",
      usage: u1,
      assistantMessageEvent: { type: "toolcall_delta", contentIndex: 2, delta },
    });
  }
  records.push({
    type: "message_update",
    usage: u1,
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 2,
      toolCall: { type: "toolCall", id: toolCallId, name: "read", arguments: toolArgs },
    },
  });
  records.push({ type: "message_end", message: first });
  messages.push(first);

  // 工具执行
  const result = { content: [{ type: "text" as const, text: toolOutput }], details: {} };
  records.push({ type: "tool_execution_start", toolCallId, toolName: "read", args: toolArgs });
  records.push({
    type: "tool_execution_update",
    toolCallId,
    toolName: "read",
    args: toolArgs,
    partialResult: { content: [{ type: "text", text: "# 示例工作区" }], details: {} },
  });
  records.push({
    type: "tool_execution_end",
    toolCallId,
    toolName: "read",
    result,
    isError: false,
  });
  const toolResult: AgentMessage = {
    role: "toolResult",
    toolCallId,
    toolName: "read",
    content: result.content,
    isError: false,
    timestamp: now + 2,
  };
  records.push({ type: "message_start", message: toolResult });
  records.push({ type: "message_end", message: toolResult });
  messages.push(toolResult);
  records.push({ type: "turn_end", message: first, toolResults: [toolResult] });

  // 第二轮：最终回答
  const u2 = usage(220, 80);
  const second: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: answer }],
    stopReason: "stop",
    usage: u2,
    timestamp: now + 3,
    ...MODEL,
  };
  records.push({ type: "turn_start" });
  records.push({
    type: "message_start",
    message: { ...second, content: [], stopReason: "pending" },
  });
  streamText(records, "text", 0, answer, u2);
  records.push({ type: "message_end", message: second });
  messages.push(second);
  records.push({ type: "turn_end", message: second, toolResults: [] });

  records.push({ type: "agent_end", messages: messages.slice(), willRetry: false });
  records.push({ type: "agent_settled", aborted: false });
  return { records, messages };
}
