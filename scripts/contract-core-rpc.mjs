#!/usr/bin/env node
// Agent Core RPC 契约测试（技术方案第 23 章测试分层：Node 脚本 + 真实 Core 构建产物 + Faux provider）。
// 对锁定版本的 Core 逐条验证桌面端依赖的 RPC 命令与事件；升级 Core 前后都要跑（PATCHES.md 升级流程）。
//
//   node scripts/contract-core-rpc.mjs                 跑 agent-core 构建目录里的 rpc-entry.js（当前 node）
//   node scripts/contract-core-rpc.mjs --dist          跑组装好的 dist/agent-core（第 3.2 节安装布局）
//   node scripts/contract-core-rpc.mjs --entry <js> [--node <exe>]   指定入口与运行时（同 smoke-core-rpc.mjs）
//   node scripts/contract-core-rpc.mjs --case prompt   只跑一条用例（可重复）
//
// stream 用例把真实 Core 的记录交给桌面端会话 store（apps/desktop/src/stores/session-store.ts）重建，
// 验收第 7.4 节：流式重建出的消息与 message_end 的最终消息一致，agent_settled 才解锁输入。
//
// 每条用例单独起一个 Core 进程与一个 Faux 模型服务（core-contract/faux-model.mjs），配置与会话目录在临时目录，
// --offline 运行；模型请求只发到 127.0.0.1 上的 Faux 服务。
// 记录类型对照 packages/protocol（Node 24 直接加载其 .ts 源码，类型注解在加载时擦除）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  ASSISTANT_MESSAGE_EVENT_TYPES,
  SESSION_EVENT_TYPES,
} from "../packages/protocol/src/events.ts";
import { CoreProcess } from "./core-contract/core-process.mjs";
import {
  FAUX_MODEL,
  FAUX_PROVIDER,
  fauxModelsJson,
  lastUserText,
  startFauxModel,
} from "./core-contract/faux-model.mjs";
import { CoreTargetError, coreEnv, prepareCoreTarget } from "./core-target.mjs";

// 桌面端会话 store：apps/desktop 不是 ESM 包（无 "type": "module"，Next.js 配置按 CommonJS 约定），
// Node 加载其 .ts 源码时会按 ES 模块重新解析并告警 MODULE_TYPELESS_PACKAGE_JSON；这条告警与契约无关，只滤掉它
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const code = typeof rest[0] === "object" ? rest[0]?.code : rest[1];
  if (code !== "MODULE_TYPELESS_PACKAGE_JSON") emitWarning.call(process, warning, ...rest);
};
const { applyChunks, initialSessionState } = await import(
  "../apps/desktop/src/stores/session-store.ts"
);
process.emitWarning = emitWarning;

const { values: args } = parseArgs({
  options: {
    dist: { type: "boolean", default: false },
    entry: { type: "string" },
    node: { type: "string" },
    case: { type: "string", multiple: true },
  },
});

// RPC 模式下 stdout 上除会话事件与 response 外还可能出现的记录（rpc.md「Protocol records」）
const OTHER_RECORD_TYPES = new Set(["response", "extension_ui_request", "extension_error"]);
const KNOWN_RECORD_TYPES = new Set([...SESSION_EVENT_TYPES, ...OTHER_RECORD_TYPES]);
const KNOWN_DELTA_TYPES = new Set(ASSISTANT_MESSAGE_EVENT_TYPES);

class ContractError extends Error {}

function check(condition, message) {
  if (!condition) throw new ContractError(message);
}

const json = (value) => JSON.stringify(value);

/** 助手消息的全部文本块 */
function textOf(message) {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Core 只应向模型端点发 Messages 请求 */
function checkFauxRequests(faux) {
  check(
    faux.unexpected.length === 0,
    `Core 向模型端点发出了意外请求：${faux.unexpected.join("、")}`,
  );
}

/** stdout 只有协议记录：不得出现非 JSON 行或不以 LF 结尾的残余 */
function checkNoInvalidLines(core) {
  check(core.invalidLines.length === 0, `stdout 出现非 JSON 行：${json(core.invalidLines[0])}`);
}

/**
 * 从 fromIndex 起检查记录类型都在协议定义之内，message_update 的增量类型也在定义之内；
 * text_delta 须带非负整数 contentIndex 与字符串 delta（桌面端流式重建按 contentIndex 定位文本块，缺失或为负即丢弃增量）
 */
function checkKnownRecords(core, fromIndex = 0) {
  checkNoInvalidLines(core);
  for (const record of core.records.slice(fromIndex)) {
    check(
      KNOWN_RECORD_TYPES.has(record.type),
      `协议未定义的记录类型 ${record.type}：${json(record)}`,
    );
    if (record.type === "message_update") {
      const t = record.assistantMessageEvent?.type;
      check(KNOWN_DELTA_TYPES.has(t), `协议未定义的 message_update 增量类型 ${t}`);
      if (t === "text_delta") {
        const e = record.assistantMessageEvent;
        check(
          Number.isInteger(e.contentIndex) && e.contentIndex >= 0 && typeof e.delta === "string",
          `text_delta 的 contentIndex 或 delta 不合法：${json(record)}`,
        );
      }
    }
  }
}

/** 本轮（fromIndex 之后）助手消息的 message_end */
function assistantEnd(core, fromIndex) {
  return core.records
    .slice(fromIndex)
    .find((r) => r.type === "message_end" && r.message?.role === "assistant");
}

/**
 * 本轮所有 text_delta 增量依次拼接的文本。
 * Faux 回复只有索引 0 的一个文本块，所以每个增量的 contentIndex 都须为 0
 * （桌面端按 contentIndex 把增量写入对应文本块，索引偏移不会让拼接结果出错，须单独断言）。
 */
function streamedText(core, fromIndex) {
  const deltas = core.records
    .slice(fromIndex)
    .filter((r) => r.type === "message_update" && r.assistantMessageEvent?.type === "text_delta")
    .map((r) => r.assistantMessageEvent);
  check(
    deltas.every((e) => e.contentIndex === 0),
    `text_delta 的 contentIndex 应全部为 0：${json(deltas.map((e) => e.contentIndex))}`,
  );
  return deltas.map((e) => e.delta).join("");
}

/** 记录在 fromIndex 之后首次出现的位置（未出现为 -1） */
function indexOfType(core, type, fromIndex) {
  const i = core.records.slice(fromIndex).findIndex((r) => r.type === type);
  return i === -1 ? -1 : fromIndex + i;
}

async function expectIdleState(core, expected) {
  const state = await core.request({ type: "get_state" });
  check(state.success === true, `get_state 失败：${json(state)}`);
  check(state.data?.isStreaming === false, `会话应已空闲：${json(state.data)}`);
  if (expected.messageCount !== undefined)
    check(
      state.data.messageCount === expected.messageCount,
      `messageCount 应为 ${expected.messageCount}，实际 ${state.data.messageCount}`,
    );
  return state;
}

// ---------- 流式重建（第 7.4 节） ----------

/** 内容块中流式重建关心的部分：签名等只在 message_end 里出现的供应商字段不比较 */
function blockSummary(block) {
  switch (block?.type) {
    case "text":
      return { type: "text", text: block.text };
    case "thinking":
      return { type: "thinking", thinking: block.thinking };
    case "toolCall":
      return { type: "toolCall", id: block.id, name: block.name, arguments: block.arguments };
    default:
      return block;
  }
}
/** 消息内容的摘要；用户消息的 content 可能是字符串，原样比较 */
const contentSummary = (message) =>
  Array.isArray(message?.content) ? message.content.map(blockSummary) : message?.content;

/**
 * Core 层的流式不变量：每条助手消息的每个内容块，增量依次拼接 = *_end 的完整内容 = message_end 中的该块。
 * 返回检查过的助手消息数
 */
function checkStreamInvariants(core, fromIndex) {
  let open; // 当前消息：{ blocks: Map<index, { kind, text }>, ends: Map<index, content> }
  let checked = 0;
  for (const r of core.records.slice(fromIndex)) {
    if (r.type === "message_start" && r.message?.role === "assistant") {
      open = { blocks: new Map(), ends: new Map() };
    } else if (r.type === "message_update" && open) {
      const e = r.assistantMessageEvent;
      const i = e.contentIndex;
      if (/_start$/.test(e.type)) {
        check(!open.blocks.has(i), `contentIndex ${i} 重复 start：${json(e)}`);
        open.blocks.set(i, { kind: e.type.replace("_start", ""), text: "" });
      } else if (/_delta$/.test(e.type)) {
        const b = open.blocks.get(i);
        check(b && `${b.kind}_delta` === e.type, `增量没有对应的 start：${json(e)}`);
        check(!open.ends.has(i), `块 ${i} 已 end 后仍有增量：${json(e)}`);
        b.text += e.delta;
      } else if (/_end$/.test(e.type)) {
        const b = open.blocks.get(i);
        check(b && `${b.kind}_end` === e.type, `end 没有对应的 start：${json(e)}`);
        if (e.type === "toolcall_end") {
          check(
            json(JSON.parse(b.text)) === json(e.toolCall.arguments),
            `toolcall_delta 拼接的参数与 toolcall_end 不符：${json(b.text)} / ${json(e.toolCall.arguments)}`,
          );
          open.ends.set(i, blockSummary(e.toolCall));
        } else {
          check(
            b.text === e.content,
            `${b.kind}_delta 拼接结果与 *_end 不符：${json(b.text)} / ${json(e.content)}`,
          );
          open.ends.set(
            i,
            blockSummary(
              b.kind === "text"
                ? { type: "text", text: e.content }
                : { type: "thinking", thinking: e.content },
            ),
          );
        }
      }
    } else if (r.type === "message_end" && r.message?.role === "assistant" && open) {
      const final = contentSummary(r.message);
      check(
        open.ends.size === final.length,
        `message_end 有 ${final.length} 个块，流中 end 了 ${open.ends.size} 个`,
      );
      for (const [i, block] of open.ends)
        check(
          json(block) === json(final[i]),
          `块 ${i} 的 *_end 与 message_end 不符：${json(block)} / ${json(final[i])}`,
        );
      open = undefined;
      checked++;
    }
  }
  return checked;
}

/**
 * 把真实 Core 的记录按不同批次大小交给桌面端会话 store（每批一次 applyChunks，同 16ms 合批），检查：
 * 每条 message_end 到达前，store 中流式重建的消息内容与最终消息一致；agent_start 到 agent_settled 之间锁定输入，
 * agent_end 之后不解锁；全部应用后 store 的消息（system 除外）与 get_messages 一致。
 */
function checkStoreReplay(records, history) {
  for (const size of [1, 3, 16, records.length]) {
    let state = initialSessionState;
    let settled = true;
    let batch = [];
    const flush = () => {
      if (batch.length) state = applyChunks(state, [{ records: batch, gap: false }]);
      batch = [];
    };
    for (const r of records) {
      if (r.type === "message_end") {
        // 在 message_end 之前切开批次，取此刻 store 里流式重建的结果
        flush();
        check(state.streamingMessage, `批次 ${size}：message_end 前 store 应处于流式输出中`);
        const streamed = state.messages.at(-1);
        check(
          json(contentSummary(streamed)) === json(contentSummary(r.message)),
          `批次 ${size}：流式重建的消息与 message_end 不符：${json(contentSummary(streamed))} / ${json(contentSummary(r.message))}`,
        );
      }
      if (r.type === "agent_start") settled = false;
      if (r.type === "agent_settled") settled = true;
      batch.push(r);
      if (batch.length >= size || r.type === "agent_end" || r.type === "agent_settled") {
        flush();
        check(state.running === !settled, `批次 ${size}：${r.type} 之后 running 应为 ${!settled}`);
      }
    }
    flush();
    check(!state.running && !state.streamingMessage, `批次 ${size}：本轮结束后应解锁且无流式消息`);
    // system 消息不比较：事件流与 get_messages 中的 system 消息各自生成（时间戳、toolsAdded 等字段不同）
    const timeline = state.messages.filter((m) => m.role !== "system");
    check(
      json(timeline) === json(history),
      `批次 ${size}：store 重建的消息与 get_messages 不一致：${json(timeline)} / ${json(history)}`,
    );
  }
}

// ---------- 用例 ----------

const cases = {
  /** get_state：新会话的状态快照，模型为 Faux，未在运行 */
  async get_state({ core }) {
    const r = await core.request({ type: "get_state" });
    check(r.command === "get_state" && r.success === true, `get_state 响应异常：${json(r)}`);
    const d = r.data ?? {};
    check(typeof d.sessionId === "string" && d.sessionId !== "", `缺少 sessionId：${json(d)}`);
    check(
      d.model?.provider === FAUX_PROVIDER && d.model?.id === FAUX_MODEL,
      `当前模型应为 ${FAUX_PROVIDER}/${FAUX_MODEL}：${json(d.model)}`,
    );
    check(
      d.model?.api === "anthropic-messages",
      `模型 api 应为 anthropic-messages：${d.model?.api}`,
    );
    check(d.isStreaming === false && d.isCompacting === false, `新会话不应在运行：${json(d)}`);
    check(d.messageCount === 0 && d.pendingMessageCount === 0, `新会话应无消息：${json(d)}`);
    for (const key of ["thinkingLevel", "steeringMode", "followUpMode"])
      check(typeof d[key] === "string", `${key} 应为字符串：${json(d[key])}`);
    check(typeof d.autoCompactionEnabled === "boolean", "autoCompactionEnabled 应为布尔值");
    checkKnownRecords(core);
  },

  /** prompt：受理即回 response（disposition started），随后流式事件，agent_settled 结束本轮 */
  async prompt({ core, faux }) {
    // 增量里放 U+2028：Core 输出与本脚本分帧都不能把它当换行
    const chunks = ["你好，", "我是 Faux", "\u2028契约测试。"];
    const expected = chunks.join("");
    faux.enqueue({ chunks });

    const from = core.records.length;
    const r = await core.request({ type: "prompt", message: "你好" });
    check(r.command === "prompt" && r.success === true, `prompt 响应异常：${json(r)}`);
    check(r.data?.disposition === "started", `disposition 应为 started：${json(r.data)}`);

    const settled = await core.waitFor((x) => x.type === "agent_settled", {
      label: "agent_settled",
      fromIndex: from,
    });
    check(settled.aborted === false, `正常结束的一轮 aborted 应为 false：${json(settled)}`);

    const start = indexOfType(core, "agent_start", from);
    const end = indexOfType(core, "agent_end", from);
    const settledAt = indexOfType(core, "agent_settled", from);
    check(
      start !== -1 && end > start && settledAt > end,
      "事件顺序应为 agent_start → agent_end → agent_settled",
    );
    // prompt 受理即回 response，不等本轮结束（waitFor 会找到已到达的 agent_settled，所以要单独查顺序）
    check(core.records.indexOf(r) < settledAt, "prompt 的 response 应先于 agent_settled 到达");

    check(
      streamedText(core, from) === expected,
      `text_delta 拼接结果不符：${json(streamedText(core, from))}`,
    );
    const done = assistantEnd(core, from);
    check(done, "缺少助手消息的 message_end");
    check(textOf(done.message) === expected, `message_end 文本不符：${json(textOf(done.message))}`);
    check(done.message.stopReason === "stop", `stopReason 应为 stop：${done.message.stopReason}`);
    check(
      done.message.provider === FAUX_PROVIDER && done.message.model === FAUX_MODEL,
      "助手消息的供应商与模型不符",
    );

    const request = faux.requests.find((q) => lastUserText(q.body) === "你好");
    check(
      request,
      `Faux 模型服务未收到含用户消息的请求：${json(faux.requests.map((q) => q.path))}`,
    );
    check(
      request.body.model === FAUX_MODEL && request.body.stream === true,
      "模型请求应为流式且指定 Faux 模型",
    );

    const messages = await core.request({ type: "get_messages" });
    check(messages.success === true, `get_messages 失败：${json(messages)}`);
    const list = messages.data?.messages ?? [];
    // 锁定版本的 Core：新会话历史以一条 system 消息开头，随后恰好是本轮一条用户消息、一条助手消息
    const roles = list.map((m) => m.role);
    check(
      json(roles) === json(["system", "user", "assistant"]),
      `get_messages 应恰好为 system → user → assistant 三条：${json(roles)}`,
    );
    const [, user, assistant] = list;
    check(
      lastUserText({ messages: [user] }) === "你好" && textOf(assistant) === expected,
      `get_messages 应包含本轮问答：${json(list)}`,
    );

    await expectIdleState(core, { messageCount: list.length });
    checkFauxRequests(faux);
    checkKnownRecords(core);
  },

  /** abort：运行中中止，等会话空闲后才回 response；助手消息 stopReason 为 aborted，供应商请求被取消 */
  async abort({ core, faux }) {
    const chunks = Array.from({ length: 200 }, (_, i) => `第${i}段。`);
    faux.enqueue({ chunks, delayMs: 50 }); // 约 10 秒，足够在中途中止

    const from = core.records.length;
    const r = await core.request({ type: "prompt", message: "请慢慢说" });
    check(r.success === true && r.data?.disposition === "started", `prompt 响应异常：${json(r)}`);
    await core.waitFor(
      (x) => x.type === "message_update" && x.assistantMessageEvent?.type === "text_delta",
      { label: "第一个 text_delta", fromIndex: from },
    );

    const a = await core.request({ type: "abort" });
    check(a.command === "abort" && a.success === true, `abort 响应异常：${json(a)}`);
    // abort 等会话空闲后才响应：此时本轮的助手消息已经结束
    const abortAt = core.records.indexOf(a);
    const done = assistantEnd(core, from);
    check(
      done && core.records.indexOf(done) < abortAt,
      "abort 的 response 应在助手消息 message_end 之后",
    );
    check(
      done.message.stopReason === "aborted",
      `stopReason 应为 aborted：${done.message.stopReason}`,
    );
    const partial = streamedText(core, from);
    check(
      partial.length > 0 && partial.length < chunks.join("").length,
      "中止后的文本应只有部分内容",
    );

    const settled = await core.waitFor((x) => x.type === "agent_settled", {
      label: "agent_settled",
      fromIndex: from,
    });
    check(settled.aborted === true, `中止的一轮 aborted 应为 true：${json(settled)}`);
    // 会话空闲（agent_settled）之后才回 abort 的 response
    check(
      core.records.indexOf(settled) < abortAt,
      "abort 的 response 应在 agent_settled 之后（会话空闲后才响应）",
    );

    // 供应商请求应被取消（连接断开），而不是读完整个流
    const request = faux.requests.find((q) => lastUserText(q.body) === "请慢慢说");
    check(request, "Faux 模型服务未收到本轮请求");
    for (let i = 0; i < 20 && !request.clientAborted; i++)
      await new Promise((res) => setTimeout(res, 100));
    check(request.clientAborted && !request.completed, "中止后模型请求应被断开");

    await expectIdleState(core, {});
    checkFauxRequests(faux);
    checkKnownRecords(core);
  },
  /**
   * stream：一轮含思考、文本、工具调用（读文件）与第二次模型回复的运行；验证 Core 的流式不变量，
   * 并用桌面端会话 store 重建，流式结果须与最终消息一致（第 7.4 节，第 4 周验收：假模型流式输出与最终消息一致）
   */
  async stream({ core, faux, workDir }) {
    writeFileSync(join(workDir, "hello.txt"), "乾元\n");
    faux.enqueue({
      blocks: [
        { type: "thinking", chunks: ["先读", "一下\u2028文件。"], signature: "faux-sig" },
        { type: "text", chunks: ["我来", "读取 ", "hello.txt。"] },
        {
          type: "tool_use",
          id: "toolu_faux_1",
          name: "read",
          chunks: ['{"pa', 'th":"hel', 'lo.txt"}'],
        },
      ],
    });
    faux.enqueue({ chunks: ["文件内容是", "「乾元」", "。"] });

    const from = core.records.length;
    const r = await core.request({ type: "prompt", message: "读一下 hello.txt" });
    check(r.success === true && r.data?.disposition === "started", `prompt 响应异常：${json(r)}`);
    await core.waitFor((x) => x.type === "agent_settled", {
      label: "agent_settled",
      fromIndex: from,
    });

    const ends = core.records
      .slice(from)
      .filter((x) => x.type === "message_end" && x.message?.role === "assistant");
    check(ends.length === 2, `本轮应有两条助手消息（工具调用与最终回答）：${ends.length}`);
    check(
      json(contentSummary(ends[0].message).map((b) => b.type)) ===
        json(["thinking", "text", "toolCall"]),
      `第一条助手消息应为思考、文本、工具调用：${json(contentSummary(ends[0].message))}`,
    );
    check(
      json(contentSummary(ends[0].message)[0]) ===
        json({ type: "thinking", thinking: "先读一下\u2028文件。" }),
      `第一条助手消息的思考内容不符：${json(contentSummary(ends[0].message)[0])}`,
    );
    check(
      ends[0].message.stopReason === "toolUse",
      `第一条 stopReason 应为 toolUse：${ends[0].message.stopReason}`,
    );
    // 工具执行与 follow-up 都按 toolu_faux_1 定位，所以要确认助手消息里的 toolCall 就是这个 id
    const toolCall = contentSummary(ends[0].message).find((b) => b.type === "toolCall");
    check(
      toolCall?.id === "toolu_faux_1",
      `第一条助手消息的 toolCall id 应为 toolu_faux_1：${json(toolCall)}`,
    );
    check(
      textOf(ends[1].message) === "文件内容是「乾元」。",
      `最终回答不符：${json(textOf(ends[1].message))}`,
    );
    const toolEnd = core.records
      .slice(from)
      .find((x) => x.type === "tool_execution_end" && x.toolCallId === "toolu_faux_1");
    check(toolEnd && toolEnd.isError === false, `read 工具应执行成功：${json(toolEnd)}`);
    // 工具确实读到了完整文件（含末尾换行），且原样作为 tool_result 发回了模型
    const fileText = "乾元\n";
    check(
      json(toolEnd.result?.content) === json([{ type: "text", text: fileText }]),
      `read 工具结果应为完整文件内容：${json(toolEnd.result)}`,
    );
    // tool_result 只能出现在 user 消息里：Faux 不读请求体，放错角色也不会改变回复，须在此断言
    const toolResultsByRole = faux.requests.flatMap((q) =>
      (q.body?.messages ?? []).flatMap((m) =>
        Array.isArray(m.content)
          ? m.content.filter((c) => c.type === "tool_result").map((c) => ({ role: m.role, c }))
          : [],
      ),
    );
    check(
      toolResultsByRole.every((x) => x.role === "user"),
      `tool_result 只应出现在 user 消息中：${json(toolResultsByRole)}`,
    );
    const toolResults = toolResultsByRole.filter((x) => x.role === "user").map((x) => x.c);
    check(
      toolResults.length === 1 &&
        toolResults[0].tool_use_id === "toolu_faux_1" &&
        toolResults[0].is_error === false &&
        toolResults[0].content === fileText,
      `第二次模型请求应带上 tool_use_id 为 toolu_faux_1、内容为完整文件的 tool_result：${json(toolResults)}`,
    );

    check(checkStreamInvariants(core, from) === 2, "应检查到两条助手消息的流式不变量");

    const messages = await core.request({ type: "get_messages" });
    check(messages.success === true, `get_messages 失败：${json(messages)}`);
    const history = messages.data.messages.filter((m) => m.role !== "system");
    checkStoreReplay(
      core.records.slice(from).filter((x) => x.type !== "response"),
      history,
    );

    await expectIdleState(core, {});
    checkFauxRequests(faux);
    checkKnownRecords(core);
  },
};

// ---------- 运行 ----------

async function runCase(name, target) {
  const sandbox = mkdtempSync(join(tmpdir(), `primus-core-contract-${name}-`));
  let faux;
  let core;
  const started = Date.now();
  try {
    const coreDir = join(sandbox, "core");
    const workDir = join(sandbox, "work");
    mkdirSync(coreDir);
    mkdirSync(workDir);
    faux = await startFauxModel();
    writeFileSync(
      join(coreDir, "models.json"),
      JSON.stringify(fauxModelsJson(faux.baseUrl), null, 2),
    );
    core = new CoreProcess({
      ...target,
      args: ["--offline", "--provider", FAUX_PROVIDER, "--model", FAUX_MODEL],
      cwd: workDir,
      // 本机 Faux 服务不能走代理：CI 或开发机配置的 HTTP(S)_PROXY 会让 127.0.0.1 的请求失败
      env: {
        ...coreEnv({ home: sandbox, coreDir }),
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
      },
    });
    await cases[name]({ core, faux, workDir });
    // 有序退出：关闭 stdin 后 Core 应以 0 退出；stdout 须读完（否则残余未计入，检查不完整），
    // 关闭阶段到达的记录同样要符合协议，且不得有非法行（含不以 LF 结尾的残余）
    const code = await core.stop();
    check(
      code === 0,
      `关闭 stdin 后 Core 应以 0 退出，实际 ${code ?? "未在时限内退出，已强制结束"}`,
    );
    check(
      core.stdoutEnded,
      "Core 退出后 stdout 未在时限内结束（仍被子进程持有），无法确认没有非法行",
    );
    checkKnownRecords(core);
    console.log(`✓ ${name}（${Date.now() - started} ms）`);
    return true;
  } catch (err) {
    console.error(`✗ ${name}：${err.message}`);
    if (!(err instanceof ContractError)) console.error(err.stack);
    if (core) console.error(`--- Core stderr ---\n${core.stderr}`);
    return false;
  } finally {
    await core?.stop();
    await faux?.close();
    removeDir(sandbox);
  }
}

/** 删除临时目录；Windows 上刚退出的进程可能仍短暂占用文件，重试后仍失败只告警 */
function removeDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (err) {
    console.warn(`⚠ 临时目录清理失败（不影响结果）：${dir}：${err.message}`);
  }
}

const selected = args.case ?? Object.keys(cases);
const unknown = selected.filter((name) => !(name in cases));
if (unknown.length) {
  console.error(`✗ 未知用例：${unknown.join("、")}（可选：${Object.keys(cases).join("、")}）`);
  process.exit(1);
}

// dist 模式要复制产物，所有用例共用一份
const targetSandbox = mkdtempSync(join(tmpdir(), "primus-core-contract-target-"));
let target;
try {
  target = prepareCoreTarget({
    dist: args.dist,
    entry: args.entry,
    node: args.node,
    sandbox: targetSandbox,
  });
} catch (err) {
  removeDir(targetSandbox);
  if (err instanceof CoreTargetError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
if (target.note) console.log(`· dist 契约测试：${target.note}`);

let failed = 0;
try {
  for (const name of selected)
    if (!(await runCase(name, { entry: target.entry, nodeExe: target.nodeExe }))) failed++;
} finally {
  removeDir(targetSandbox);
}

if (failed) {
  console.error(`✗ RPC 契约测试：${failed}/${selected.length} 条用例失败`);
  process.exit(1);
}
console.log(`✓ RPC 契约测试：${selected.length} 条用例全部通过`);
