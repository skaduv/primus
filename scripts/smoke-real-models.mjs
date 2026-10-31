#!/usr/bin/env node
// 真实模型冒烟（第 4 周第 3 项，仅限开发）：用开发用 models.json（放在已 gitignore 的
// .dev-data/dev-models.json，或 --models 指定）对其中每个供应商拉起 Core，各完成一次含工具调用的对话：
// 让模型用 read 工具读取临时目录里的文件并复述其中的口令，检查 tool_execution_end 成功且回复含口令。
// 模板见 scripts/dev-models.example.json（复制到 .dev-data/dev-models.json 后填入端点与模型）。
// 密钥不落盘（AGENTS.md 2.5）：apiKey 只能写 Core 支持的引用——"$环境变量名" 或 "!取密钥命令"，
// 字面量 key 直接拒绝；Core 在运行时按引用取值，写给 Core 的临时 models.json 里也只有引用。
// 用法：PRIMUS_DEV_OPENAI_API_KEY=… PRIMUS_DEV_ANTHROPIC_API_KEY=… node scripts/smoke-real-models.mjs [--models <path>] [--provider <id>] [--timeout <ms>]
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CoreProcess } from "./core-contract/core-process.mjs";
import { coreEnv, prepareCoreTarget } from "./core-target.mjs";

const ALLOWED_APIS = new Set(["openai-responses", "anthropic-messages"]);
// 供应商 ID 参与临时目录拼接，只允许安全字符（排除路径分隔符、"."、".."）
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ENV_REF = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

/** apiKey 必须是引用而非字面量；"$NAME" 时还要求该环境变量已设置。返回错误说明或 undefined */
function checkApiKey(apiKey) {
  if (typeof apiKey !== "string" || !apiKey) return '缺少 apiKey（应为 "$环境变量名" 或 "!命令"）';
  if (apiKey.startsWith("!")) return undefined;
  const env = ENV_REF.exec(apiKey);
  if (!env) return 'apiKey 必须是 "$环境变量名" 或 "!命令"，不接受明文 key';
  if (!process.env[env[1]]) return `环境变量 ${env[1]} 未设置`;
  return undefined;
}
const { values: args } = parseArgs({
  options: {
    models: { type: "string", default: resolve(".dev-data/dev-models.json") },
    provider: { type: "string" },
    timeout: { type: "string", default: "120000" },
  },
});

const config = JSON.parse(readFileSync(args.models, "utf8"));
const providers = Object.entries(config.providers ?? {}).filter(
  ([id]) => !args.provider || id === args.provider,
);
if (!providers.length) {
  console.error(`✗ ${args.models} 中没有可用的供应商`);
  process.exit(1);
}

const textOf = (message) =>
  (message?.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");

const sandbox = mkdtempSync(join(tmpdir(), "primus-real-models-"));
let failed = 0;
try {
  const target = prepareCoreTarget({ sandbox: join(sandbox, "target") });
  for (const [id, provider] of providers) {
    const label = `${id}（${provider.api}）`;
    if (!PROVIDER_ID.test(id)) {
      console.error(`✗ ${JSON.stringify(id)}：供应商 ID 只能包含字母、数字、- 和 _`);
      failed++;
      continue;
    }
    if (!ALLOWED_APIS.has(provider.api)) {
      console.error(`✗ ${label}：只允许 openai-responses / anthropic-messages`);
      failed++;
      continue;
    }
    const keyProblem = checkApiKey(provider.apiKey);
    if (keyProblem) {
      console.error(`✗ ${label}：${keyProblem}`);
      failed++;
      continue;
    }
    const model = provider.models?.[0]?.id;
    const coreDir = join(sandbox, id, "core");
    const workDir = join(sandbox, id, "work");
    mkdirSync(coreDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(coreDir, "models.json"), JSON.stringify({ providers: { [id]: provider } }));
    const secret = `乾元-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(join(workDir, "口令.txt"), `口令是：${secret}\n`);
    const core = new CoreProcess({
      ...target,
      args: ["--provider", id, "--model", model, "--no-session"],
      cwd: workDir,
      env: coreEnv({ home: join(sandbox, id), coreDir }),
    });
    const started = Date.now();
    try {
      const from = core.records.length;
      const r = await core.request(
        {
          type: "prompt",
          message: "请用 read 工具读取当前目录下的「口令.txt」，然后只回复文件里的口令。",
        },
        { timeoutMs: Number(args.timeout) },
      );
      if (r.success !== true) throw new Error(`prompt 被拒绝：${JSON.stringify(r)}`);
      await core.waitFor((x) => x.type === "agent_settled", {
        label: "agent_settled",
        fromIndex: from,
        timeoutMs: Number(args.timeout),
      });
      const records = core.records.slice(from);
      const tools = records.filter((x) => x.type === "tool_execution_end");
      const errors = records.filter((x) => x.type === "message_end" && x.message?.errorMessage);
      if (errors.length)
        throw new Error(
          `模型报错：${errors
            .map((e) => e.message.errorMessage)
            .join("；")
            .slice(0, 300)}`,
        );
      if (!tools.some((t) => t.toolName === "read" && !t.isError)) {
        throw new Error(
          `没有成功的 read 工具调用：${JSON.stringify(tools.map((t) => [t.toolName, t.isError]))}`,
        );
      }
      const answer = records
        .filter((x) => x.type === "message_end" && x.message?.role === "assistant")
        .map((x) => textOf(x.message))
        .at(-1);
      if (!answer?.includes(secret))
        throw new Error(`回复未包含口令 ${secret}：${JSON.stringify(answer)}`);
      console.log(`✓ ${label} ${model}：调用 read 并复述口令（${Date.now() - started} ms）`);
    } catch (err) {
      failed++;
      console.error(`✗ ${label} ${model}：${err.message}\n--- Core stderr ---\n${core.stderr}`);
    } finally {
      await core.stop();
    }
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
