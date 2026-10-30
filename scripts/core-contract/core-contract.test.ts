import { afterEach, describe, expect, it } from "vitest";
import { CoreTargetError, prepareCoreTarget } from "../core-target.mjs";
import { CoreProcess, JsonlDecoder } from "./core-process.mjs";
import {
  DEFAULT_REPLY,
  FAUX_MODEL,
  FAUX_PROVIDER,
  fauxModelsJson,
  lastUserText,
  sseEvents,
  startFauxModel,
} from "./faux-model.mjs";

describe("JsonlDecoder（与薄壳相同的分帧）", () => {
  it("只按 LF 切分，去掉行尾 CR，跨块拼接", () => {
    const d = new JsonlDecoder();
    expect(d.push(Buffer.from('{"a":1}\r\n{"b"'))).toEqual(['{"a":1}']);
    expect(d.push(Buffer.from(":2}\n"))).toEqual(['{"b":2}']);
    expect(d.pendingBytes).toBe(0);
  });

  it("U+2028 / U+2029 不是记录边界", () => {
    const line = JSON.stringify({ text: "a\u2028b\u2029c" });
    expect(new JsonlDecoder().push(Buffer.from(`${line}\n`))).toEqual([line]);
  });

  it("多字节 UTF-8 字符被拆在两个块之间时正确解码", () => {
    const bytes = Buffer.from('{"t":"乾元"}\n');
    const d = new JsonlDecoder();
    expect(d.push(bytes.subarray(0, 7))).toEqual([]);
    expect(d.push(bytes.subarray(7))).toEqual(['{"t":"乾元"}']);
  });

  it("未以 LF 结尾的残余保留在 pendingBytes，flush 取出并清空", () => {
    const d = new JsonlDecoder();
    expect(d.push(Buffer.from('{"a":1}'))).toEqual([]);
    expect(d.pendingBytes).toBe(7);
    expect(d.flush()).toBe('{"a":1}');
    expect(d.pendingBytes).toBe(0);
  });
});

describe("CoreProcess", () => {
  // 用 node -e 跑一个最小的假 Core：回显命令为 response，并输出一行非 JSON 与一段不以 LF 结尾的残余
  const fake = (code: string) =>
    new CoreProcess({
      nodeExe: process.execPath,
      entry: "-e",
      args: [code],
      cwd: process.cwd(),
      env: process.env,
    });

  it("按 id 关联 response，记录非 JSON 行与 stdout 结束时的残余", async () => {
    const core = fake(`
      process.stdout.write("not json\\n\\n  \\n");
      process.stdin.on("data", (d) => {
        for (const line of String(d).split("\\n").filter(Boolean)) {
          const c = JSON.parse(line);
          process.stdout.write(JSON.stringify({ type: "response", id: c.id, command: c.type, success: true, data: { t: "a\\u2028b" } }) + "\\n");
        }
      });
      process.stdin.on("end", () => process.stdout.write('{"tail":1}'));
    `);
    const r = await core.request({ type: "get_state" });
    expect(r).toMatchObject({ command: "get_state", success: true, data: { t: "a\u2028b" } });
    await core.stop();
    // 空行与仅含空白的行同样不是协议记录
    expect(core.invalidLines).toEqual(["not json", "", "  ", '{"tail":1}']);
  });

  it("等待期间进程退出时立即失败，而不是等到超时", async () => {
    const core = fake("process.exit(3)");
    await expect(core.waitFor(() => false, { label: "x", timeoutMs: 10_000 })).rejects.toThrow(
      "退出码 3",
    );
  });

  it("stop 返回退出码，可重复调用", async () => {
    const core = fake(`process.stdin.resume(); process.stdin.on("end", () => process.exit(7));`);
    expect(await core.stop()).toBe(7);
    expect(await core.stop()).toBe(7);
  });

  it("关闭 stdin 后不退出时强制结束，退出码为 null", async () => {
    const core = fake(`process.stdin.resume(); setInterval(() => {}, 1000);`);
    expect(await core.stop({ timeoutMs: 300 })).toBeNull();
    expect(core.exited).toBe(true);
  });

  it("忽略 SIGTERM 时升级为 SIGKILL，不会无限等待", async () => {
    const core = fake(`
      process.on("SIGTERM", () => {});
      process.stdin.resume();
      setInterval(() => {}, 1000);
      process.stdout.write('{"type":"ready"}\\n');
    `);
    // 等子进程装好 SIGTERM 空处理器再 stop，否则默认信号就能结束它
    await core.waitFor((x) => x.type === "ready", { label: "ready", timeoutMs: 10_000 });
    const t = Date.now();
    expect(await core.stop({ timeoutMs: 200, killGraceMs: 300 })).toBeNull();
    expect(core.exited).toBe(true);
    expect(Date.now() - t).toBeLessThan(5_000);
  });

  it("进程退出前写出的记录仍能等到（等 stdout 读完才判定进程已退出）", async () => {
    const core = fake(`
      process.stdout.write(JSON.stringify({ type: "last", pad: "x".repeat(16_000) }) + "\\n");
      process.exit(0);
    `);
    const r = await core.waitFor((x) => x.type === "last", { label: "last", timeoutMs: 10_000 });
    expect(r.pad).toHaveLength(16_000);
    expect(await core.stop()).toBe(0);
    expect(core.invalidLines).toEqual([]);
  });

  it("子进程仍持有 stdout 时，stop 最多等 drainMs 就返回", async () => {
    // 孙进程继承 stdout 并存活 3 秒，Core 本身立即退出：stdout 不会随 Core 退出而结束
    const core = fake(`
      require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { stdio: "inherit" });
      process.exit(0);
    `);
    const t = Date.now();
    expect(await core.stop({ drainMs: 300 })).toBe(0);
    expect(Date.now() - t).toBeLessThan(2_500);
    expect(core.stdoutEnded).toBe(false); // 调用方据此判定非法行检查不完整
  });

  it("运行时无法启动时报告失败", async () => {
    const core = new CoreProcess({
      nodeExe: "/不存在/node",
      entry: "x.js",
      cwd: process.cwd(),
      env: process.env,
    });
    await expect(core.waitFor(() => false, { label: "x", timeoutMs: 10_000 })).rejects.toThrow(
      "Core 进程退出",
    );
    expect(core.stderr).toContain("启动 Core 失败");
  });
});

describe("prepareCoreTarget", () => {
  it("dist 与 entry 同时指定时报错，不静默忽略 entry", () => {
    expect(() => prepareCoreTarget({ dist: true, entry: "x.js", sandbox: "/nonexistent" })).toThrow(
      CoreTargetError,
    );
  });

  it("dist 与显式空 entry 同时指定时也报错", () => {
    expect(() => prepareCoreTarget({ dist: true, entry: "", sandbox: "/nonexistent" })).toThrow(
      CoreTargetError,
    );
  });

  it("显式传入空的 entry 或 node 时报错，不静默改用默认值", () => {
    expect(() => prepareCoreTarget({ entry: "", sandbox: "/nonexistent" })).toThrow(
      "--entry 不能为空",
    );
    expect(() => prepareCoreTarget({ node: "", sandbox: "/nonexistent" })).toThrow(
      "--node 不能为空",
    );
  });
});

describe("Faux 模型服务", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("models.json 注册 anthropic-messages 供应商", () => {
    const provider = fauxModelsJson("http://127.0.0.1:1").providers[FAUX_PROVIDER];
    expect(provider).toMatchObject({ api: "anthropic-messages", baseUrl: "http://127.0.0.1:1" });
    expect(provider.models.map((m) => m.id)).toEqual([FAUX_MODEL]);
  });

  it("SSE 事件序列：message_start → 文本块 → message_delta → message_stop", () => {
    const types = sseEvents({ chunks: ["a", "b"] }).map((e) => e.type);
    expect(types).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
  });

  it("多个内容块：思考（含签名）、文本、工具调用依次编码，含工具调用时 stop_reason 为 tool_use", () => {
    const events = sseEvents({
      blocks: [
        { type: "thinking", chunks: ["想"], signature: "sig" },
        { type: "text", chunks: ["好"] },
        { type: "tool_use", id: "toolu_1", name: "read", chunks: ['{"path":', '"a"}'] },
      ],
    });
    const summary = events.map((e) =>
      e.type === "content_block_start"
        ? `${e.index}:start:${e.content_block.type}`
        : e.type === "content_block_delta"
          ? `${e.index}:${e.delta.type}`
          : e.type === "content_block_stop"
            ? `${e.index}:stop`
            : e.type,
    );
    expect(summary).toEqual([
      "message_start",
      "0:start:thinking",
      "0:thinking_delta",
      "0:signature_delta",
      "0:stop",
      "1:start:text",
      "1:text_delta",
      "1:stop",
      "2:start:tool_use",
      "2:input_json_delta",
      "2:input_json_delta",
      "2:stop",
      "message_delta",
      "message_stop",
    ]);
    expect(events.at(-2)).toMatchObject({ delta: { stop_reason: "tool_use" } });
    expect(sseEvents({ chunks: ["a"] }).at(-2)).toMatchObject({
      delta: { stop_reason: "end_turn" },
    });
  });

  it("取最后一条用户消息的文本（字符串或文本块）", () => {
    expect(lastUserText({ messages: [{ role: "user", content: "早" }] })).toBe("早");
    expect(
      lastUserText({
        messages: [
          { role: "user", content: [{ type: "text", text: "一" }] },
          { role: "assistant", content: "x" },
          { role: "user", content: [{ type: "text", text: "二" }, { type: "image" }] },
        ],
      }),
    ).toBe("二");
    expect(lastUserText(undefined)).toBeUndefined();
  });

  it("按队列回复脚本化文本，队列为空时回复默认文本；带查询参数的路径也接受", async () => {
    const faux = await startFauxModel();
    close = faux.close;
    faux.enqueue({ chunks: ["你", "好"] });
    const post = (body: unknown) =>
      fetch(`${faux.baseUrl}/v1/messages?beta=true`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.text());
    const deltas = (sse: string) =>
      [...sse.matchAll(/"text_delta","text":"([^"]*)"/g)].map((m) => m[1]).join("");

    expect(
      deltas(await post({ model: FAUX_MODEL, messages: [{ role: "user", content: "嗨" }] })),
    ).toBe("你好");
    expect(deltas(await post({ model: FAUX_MODEL, messages: [] }))).toBe(DEFAULT_REPLY);
    expect(faux.requests.map((q) => [lastUserText(q.body), q.completed])).toEqual([
      ["嗨", true],
      [undefined, true],
    ]);

    const res = await fetch(`${faux.baseUrl}/v1/models`);
    expect(res.status).toBe(404);
    expect(faux.unexpected).toEqual(["GET /v1/models"]);
  });

  it("客户端中途断开时记为 clientAborted", async () => {
    const faux = await startFauxModel();
    close = faux.close;
    faux.enqueue({ chunks: Array.from({ length: 50 }, () => "字"), delayMs: 20 });
    const controller = new AbortController();
    const res = await fetch(`${faux.baseUrl}/v1/messages`, {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    const reader = res.body?.getReader();
    await reader?.read();
    controller.abort();
    await expect.poll(() => faux.requests[0]?.clientAborted).toBe(true);
    expect(faux.requests[0]?.completed).toBe(false);
  });
});
