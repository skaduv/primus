#!/usr/bin/env node
// 推送前用 CodeRabbit CLI 在本地预审已提交的改动（CLI 额度与 PR 审查额度分开计算）。
// 只有 critical / major 问题才阻止推送；未安装 CLI、限流、网络或审查失败时只提示、不阻塞。
// 用法：
//   pnpm review:local        手动预审当前分支相对 origin/main 的已提交改动
//   pnpm hooks:install       启用 .githooks/pre-push（git push 前自动预审）
// 跳过：PRIMUS_SKIP_CR=1 git push，或 git push --no-verify。
// 基准分支：默认 origin/main，可用 PRIMUS_CR_BASE 覆盖。
import { spawn, spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/** 阻止推送的严重级别 */
export const BLOCKING = new Set(["critical", "major"]);
const CLI = "coderabbit";
const IS_WINDOWS = process.platform === "win32";

/** 解析 `coderabbit review --agent` 的一行 NDJSON；非 JSON 行返回 null */
export function parseLine(line) {
  const text = line.trim();
  if (!text.startsWith("{")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 汇总一次审查的事件流 */
export function summarize(events) {
  const findings = events.filter((e) => e?.type === "finding");
  const error = events.find((e) => e?.type === "error") ?? null;
  const complete = [...events].reverse().find((e) => e?.type === "complete") ?? null;
  const counts = {};
  for (const f of findings) {
    const severity = f.severity ?? "none";
    counts[severity] = (counts[severity] ?? 0) + 1;
  }
  const blocking = findings.filter((f) => BLOCKING.has(f.severity)).length;
  const skipped = complete?.status === "review_skipped";
  const incomplete =
    !complete ||
    Boolean(error) ||
    complete.outcome === "failed" ||
    (complete.unreviewedFileCount ?? 0) > 0;
  return { findings, counts, blocking, error, skipped, incomplete };
}

/** 错误是否为限流或额度用尽 */
export function isRateLimit(error) {
  const text = `${error?.errorType ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return /rate.?limit|quota|too many/.test(text);
}

/** 根据汇总决定是否阻止推送 */
export function decide(summary) {
  if (summary.blocking > 0) {
    return { block: true, reason: `发现 ${summary.blocking} 个 critical / major 问题` };
  }
  if (summary.skipped) return { block: false, reason: "没有需要审查的已提交改动" };
  if (summary.error) {
    const why = isRateLimit(summary.error)
      ? "CodeRabbit CLI 本小时额度已用完"
      : `审查失败：${summary.error.message ?? summary.error.errorType ?? "未知错误"}`;
    return { block: false, reason: `${why}，本次不阻塞推送` };
  }
  if (summary.incomplete) return { block: false, reason: "审查未完整结束，本次不阻塞推送" };
  return { block: false, reason: "未发现 critical / major 问题" };
}

/** 一条发现的单行展示 */
export function formatFinding(finding) {
  const file = finding.fileName ?? "(未知文件)";
  const location = finding.startLine ? `${file}:${finding.startLine}` : file;
  const text = finding.title ?? finding.comment ?? finding.codegenInstructions ?? "";
  const firstLine =
    String(text)
      .split("\n")
      .find((l) => l.trim()) ?? "";
  return `[${finding.severity ?? "none"}] ${location} ${firstLine.trim()}`;
}

/** 审查命令参数：只看已提交改动，基准为与主干的合并基点 */
export function reviewArgs(baseCommit) {
  const args = ["review", "--agent", "--committed"];
  if (baseCommit) args.push("--base-commit", baseCommit);
  return args;
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function resolveBaseCommit() {
  const base = process.env.PRIMUS_CR_BASE || "origin/main";
  return git(["merge-base", "HEAD", base]) || git(["merge-base", "HEAD", "main"]);
}

// Windows 上 CLI 可能是 .cmd 包装，需要经 shell 启动；整条命令拼成字符串，避免 args + shell 的弃用警告
function launch(args, options) {
  return IS_WINDOWS
    ? spawn([CLI, ...args].join(" "), { ...options, shell: true })
    : spawn(CLI, args, options);
}

function cliInstalled() {
  const probe = IS_WINDOWS
    ? spawnSync(`${CLI} --version`, { encoding: "utf8", shell: true })
    : spawnSync(CLI, ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

const log = (message) => console.error(`[CodeRabbit 预审] ${message}`);

function install(root) {
  const hook = join(root, ".githooks", "pre-push");
  spawnSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, stdio: "inherit" });
  try {
    chmodSync(hook, 0o755);
  } catch {
    // Windows 不需要可执行位
  }
  log("已启用 .githooks/pre-push：git push 前会自动预审");
  if (!cliInstalled()) {
    log("尚未安装 CodeRabbit CLI：PowerShell 执行 irm https://cli.coderabbit.ai/install.ps1 | iex");
    log("安装后执行 coderabbit auth login 登录");
  }
  return 0;
}

async function review() {
  if (process.env.PRIMUS_SKIP_CR === "1") {
    log("已跳过（PRIMUS_SKIP_CR=1）");
    return 0;
  }
  if (!cliInstalled()) {
    log("未找到 CodeRabbit CLI，跳过本地预审（安装方法见 scripts/README.md）");
    return 0;
  }
  const base = resolveBaseCommit();
  log(`开始审查已提交改动（基准 ${base ? base.slice(0, 7) : "CLI 默认"}），通常需要几分钟……`);
  const child = launch(reviewArgs(base), { stdio: ["ignore", "pipe", "inherit"] });
  const exited = new Promise((done) => {
    child.on("close", done);
    child.on("error", () => done(1));
  });
  const events = [];
  for await (const line of createInterface({ input: child.stdout })) {
    const event = parseLine(line);
    if (!event) continue;
    events.push(event);
    if (event.type === "finding") log(formatFinding(event));
  }
  await exited;
  const summary = summarize(events);
  const decision = decide(summary);
  log(decision.reason);
  if (decision.block) {
    log("请修复后再推送；完整内容：coderabbit review findings");
    log("确需跳过：PRIMUS_SKIP_CR=1 git push，或 git push --no-verify");
  }
  return decision.block ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const run = process.argv.includes("--install") ? Promise.resolve(install(root)) : review();
  run.then((code) => process.exit(code));
}
