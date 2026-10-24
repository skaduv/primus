#!/usr/bin/env node
// Agent Core RPC 冒烟测试（第 1 周验收：发送 get_state 能收到 response）。
// 用临时目录作为 Core 的配置目录与工作目录，离线模式运行，不读写用户真实数据。
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const entry = join(root, "agent-core/packages/coding-agent/dist/bundle/rpc-entry.js");
if (!existsSync(entry)) {
  console.error(`✗ 未找到 ${entry}，请先运行 pnpm build:core`);
  process.exit(1);
}

const sandbox = mkdtempSync(join(tmpdir(), "primus-core-smoke-"));
const timeoutMs = 30_000;
// 把 HOME / USERPROFILE 指到临时目录，Core 的配置与会话都落在其中；--offline 关闭一切联网
// TODO（品牌改动后）：改用 PRIMUS_ 前缀的配置目录变量，见 agent-core/PATCHES.md
const child = spawn(process.execPath, [entry, "--offline"], {
  cwd: sandbox,
  env: { ...process.env, HOME: sandbox, USERPROFILE: sandbox },
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (d) => {
  stderr += d;
});

let finished = false;
let childExited = false;

// 清理临时目录：Windows 上进程退出前其工作目录被占用，删除会报 EPERM，
// 所以先等 Core 进程退出再删，并带重试；清理失败只告警，不影响冒烟结论。
function cleanup() {
  try {
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (err) {
    console.warn(`⚠ 临时目录清理失败（不影响结果）：${sandbox}：${err.message}`);
  }
}

function finish(code, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (code === 0) console.log(message);
  else console.error(`${message}\n--- Core stderr ---\n${stderr}`);
  const done = () => {
    cleanup();
    process.exit(code);
  };
  if (childExited) return done();
  // 等进程退出（最多 5 秒）后再清理
  const killTimer = setTimeout(done, 5_000);
  child.once("exit", () => {
    clearTimeout(killTimer);
    done();
  });
  child.kill();
}

const timer = setTimeout(
  () => finish(1, `✗ ${timeoutMs / 1000} 秒内未收到 get_state 响应`),
  timeoutMs,
);

createInterface({ input: child.stdout }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // 非 JSON 行（不应出现，忽略）
  }
  if (msg.type !== "response" || msg.id !== "smoke-1") return;
  if (
    msg.command === "get_state" &&
    msg.success === true &&
    typeof msg.data?.sessionId === "string"
  )
    finish(0, `✓ get_state 响应正常（sessionId ${msg.data.sessionId}）`);
  else finish(1, `✗ get_state 响应异常：${line}`);
});

child.on("exit", (code) => {
  childExited = true;
  finish(1, `✗ Core 进程提前退出（退出码 ${code}）`);
});
child.stdin.write(`${JSON.stringify({ id: "smoke-1", type: "get_state" })}\n`);
