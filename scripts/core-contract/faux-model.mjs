// RPC 契约测试用的 Faux 模型服务：在 127.0.0.1 上按 Anthropic Messages 协议（anthropic-messages，两协议之一）
// 以 SSE 流式返回脚本化的回复（技术方案第 23 章：模型使用 Faux provider，脚本化输出）。
//
// 为什么在 HTTP 层模拟，而不是在 Core 进程内注册 Faux provider：进程内注册需要扩展从 Core 的上游包名导入，
// 而 agent-core/ 之外不得出现上游名称（AGENTS.md 第 2.2 节），也不应为测试改 Core 源码（第 2.3 节）。
// HTTP 层模拟让 Core 走真实的供应商适配器、鉴权与流式解析路径，契约覆盖更完整（见 docs/adr/0003）。
//
// 用法：
//   const faux = await startFauxModel();
//   faux.enqueue({ chunks: ["你好", "。"] });          // 下一次模型请求的回复；队列为空时回复 DEFAULT_REPLY
//   faux.enqueue({ chunks: [...], delayMs: 100 });     // 每个增量之间等待，用于 abort
//   faux.enqueue({ blocks: [                           // 多个内容块（流式重建用例）：思考、文本、工具调用
//     { type: "thinking", chunks: ["想", "一想"], signature: "sig" },
//     { type: "text", chunks: ["好的"] },
//     { type: "tool_use", id: "toolu_1", name: "read", chunks: ['{"path":', '"a.txt"}'] },
//   ] });                                              // 含 tool_use 时 stop_reason 为 tool_use
//   faux.requests                                      // 收到的请求（路径、请求体、是否被客户端提前断开）
//   await faux.close();
import { createServer } from "node:http";

export const FAUX_PROVIDER = "faux";
export const FAUX_MODEL = "faux-1";
export const FAUX_API_KEY = "faux-contract-key";
export const DEFAULT_REPLY = "OK";

/** Core 的 models.json：注册指向 Faux 模型服务的供应商（models-configuration.md） */
export function fauxModelsJson(baseUrl) {
  return {
    providers: {
      [FAUX_PROVIDER]: {
        name: "Faux",
        baseUrl,
        api: "anthropic-messages",
        apiKey: FAUX_API_KEY,
        models: [
          {
            id: FAUX_MODEL,
            name: "Faux 1",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 32_000,
            maxTokens: 1_024,
          },
        ],
      },
    },
  };
}

/** 一次回复的内容块：{ chunks } 是只有一个文本块的简写 */
export function replyBlocks(reply) {
  return reply.blocks ?? [{ type: "text", chunks: reply.chunks }];
}

/** 一个内容块的 content_block_start、增量与 content_block_stop（Anthropic Messages 流式格式） */
function blockEvents(block, index) {
  const delta = (d) => ({ type: "content_block_delta", index, delta: d });
  switch (block.type) {
    case "text":
      return [
        { type: "content_block_start", index, content_block: { type: "text", text: "" } },
        ...block.chunks.map((text) => delta({ type: "text_delta", text })),
        { type: "content_block_stop", index },
      ];
    case "thinking":
      return [
        {
          type: "content_block_start",
          index,
          content_block: { type: "thinking", thinking: "", signature: "" },
        },
        ...block.chunks.map((thinking) => delta({ type: "thinking_delta", thinking })),
        ...(block.signature
          ? [delta({ type: "signature_delta", signature: block.signature })]
          : []),
        { type: "content_block_stop", index },
      ];
    case "tool_use":
      return [
        {
          type: "content_block_start",
          index,
          content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
        },
        // chunks 是参数 JSON 的片段，拼起来须是完整 JSON
        ...block.chunks.map((partial_json) => delta({ type: "input_json_delta", partial_json })),
        { type: "content_block_stop", index },
      ];
    default:
      throw new Error(`Faux 模型不支持的内容块类型：${block.type}`);
  }
}

/** 把一次回复编码为 Anthropic Messages 的 SSE 事件序列（不含增量之间的延迟） */
export function sseEvents(reply, { messageId = "msg_faux", model = FAUX_MODEL } = {}) {
  const blocks = replyBlocks(reply);
  const size = blocks.flatMap((b) => b.chunks).join("").length;
  const toolUse = blocks.some((b) => b.type === "tool_use");
  return [
    {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    ...blocks.flatMap(blockEvents),
    {
      type: "message_delta",
      delta: { stop_reason: toolUse ? "tool_use" : "end_turn", stop_sequence: null },
      usage: { output_tokens: Math.max(1, Math.ceil(size / 4)) },
    },
    { type: "message_stop" },
  ];
}

export function encodeSse(event) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** 请求体里最后一条用户消息的文本 */
export function lastUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content))
      return m.content
        .filter((b) => b?.type === "text")
        .map((b) => b.text)
        .join("");
  }
  return undefined;
}

export async function startFauxModel() {
  const queue = [];
  const requests = [];
  /** 不是 Messages 流式请求的 HTTP 请求（方法与路径）；契约要求 Core 只向模型端点发 Messages 请求 */
  const unexpected = [];
  const sockets = new Set();

  const server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (d) => {
      raw += d;
    });
    req.on("end", () => {
      // Anthropic SDK 会带查询参数（如 ?beta=true），只按路径判断
      const { pathname } = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "POST" || pathname !== "/v1/messages") {
        unexpected.push(`${req.method} ${req.url}`);
        res.writeHead(404, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ type: "error", error: { type: "not_found_error", message: req.url } }),
        );
        return;
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        body = undefined;
      }
      const reply = queue.shift() ?? { chunks: [DEFAULT_REPLY] };
      const record = { path: req.url, body, completed: false, clientAborted: false };
      requests.push(record);

      const events = sseEvents(reply, { messageId: `msg_faux_${requests.length}` });
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      let i = 0;
      let timer;
      // 客户端（Core）中途断开：abort 时供应商请求应被取消
      res.on("close", () => {
        clearTimeout(timer);
        if (!record.completed) record.clientAborted = true;
      });
      const next = () => {
        if (res.destroyed) return;
        if (i >= events.length) {
          record.completed = true;
          res.end();
          return;
        }
        const event = events[i++];
        res.write(encodeSse(event));
        // 只在增量之间等待，其余事件立即发出
        const delay = event.type === "content_block_delta" ? (reply.delayMs ?? 0) : 0;
        timer = setTimeout(next, delay);
      };
      next();
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    unexpected,
    enqueue(reply) {
      queue.push(reply);
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
