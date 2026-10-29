#!/usr/bin/env node
// Agent Core RPC 契约测试（技术方案第 23 章测试分层：Node 脚本 + 真实 Core 构建产物 + Faux provider）。
// 对锁定版本的 Core 逐条验证桌面端依赖的 RPC 命令与事件；升级 Core 前后都要跑（PATCHES.md 升级流程）。
//
//   node scripts/contract-core-rpc.mjs                 跑 agent-core 构建目录里的 rpc-entry.js（当前 node）
//   node scripts/contract-core-rpc.mjs --dist          跑组装好的 dist/agent-core（第 3.2 节安装布局）
//   node scripts/contract-core-rpc.mjs --entry <js> [--node <exe>]   指定入口与运行时（同 smoke-core-rpc.mjs）
//   node scripts/contract-core-rpc.mjs --case prompt   只跑一条用例（可重复）
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
 * text_delta 须带整数 contentIndex 与字符串 delta（桌面端流式重建按 contentIndex 定位文本块，缺失即丢弃增量）
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
          Number.isInteger(e.contentIndex) && typeof e.delta === "string",
          `text_delta 缺少 contentIndex 或 delta：${json(record)}`,
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

/** 本轮 text_delta 增量依次拼接的文本（只取 contentIndex 为 0 的文本块：Faux 回复只有这一个块） */
function streamedText(core, fromIndex) {
  return core.records
    .slice(fromIndex)
    .filter(
      (r) =>
        r.type === "message_update" &&
        r.assistantMessageEvent?.type === "text_delta" &&
        r.assistantMessageEvent.contentIndex === 0,
    )
    .map((r) => r.assistantMessageEvent.delta)
    .join("");
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
    const user = list.find((m) => m.role === "user");
    const assistant = list.findLast((m) => m.role === "assistant");
    check(
      user &&
        lastUserText({ messages: [user] }) === "你好" &&
        assistant &&
        textOf(assistant) === expected,
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
    await cases[name]({ core, faux });
    // 有序退出：关闭 stdin 后 Core 应以 0 退出；stdout 读完后不得有非法行（含不以 LF 结尾的残余）
    const code = await core.stop();
    check(
      code === 0,
      `关闭 stdin 后 Core 应以 0 退出，实际 ${code ?? "未在时限内退出，已强制结束"}`,
    );
    checkNoInvalidLines(core);
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
