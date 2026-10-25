#!/usr/bin/env node
// Agent Core RPC 冒烟测试（第 1 周验收：发送 get_state 能收到 response）。
// 按薄壳的启动方式（技术方案第 4.4 节）设置 PRIMUS_ 环境变量，把 Core 的配置与会话目录
// 重定向到临时目录，离线模式运行，不读写用户真实数据；并确认 Core 没有回退到主目录下的 .primus。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
const coreDir = join(sandbox, "core");
const workDir = join(sandbox, "work");
mkdirSync(coreDir);
mkdirSync(workDir);
const timeoutMs = 30_000;
// HOME / USERPROFILE 也指到临时目录：若 Core 忽略 PRIMUS_CODING_AGENT_DIR 回退到主目录，
// 会在 sandbox/.primus 下留下痕迹，下面据此判定失败。--offline 关闭一切联网。
const child = spawn(process.execPath, [entry, "--offline"], {
  cwd: workDir,
  env: {
    ...process.env,
    HOME: sandbox,
    USERPROFILE: sandbox,
    PRIMUS_CODING_AGENT_DIR: coreDir,
    PRIMUS_CODING_AGENT_SESSION_DIR: join(coreDir, "sessions"),
    PRIMUS_SKIP_VERSION_CHECK: "1",
    PRIMUS_TELEMETRY: "0",
    NODE_OPTIONS: "",
  },
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
    !(
      msg.command === "get_state" &&
      msg.success === true &&
      typeof msg.data?.sessionId === "string"
    )
  )
    finish(1, `✗ get_state 响应异常：${line}`);
  else if (existsSync(join(sandbox, ".primus")))
    finish(1, "✗ Core 未使用 PRIMUS_CODING_AGENT_DIR，回退到了主目录下的 .primus");
  else if (!existsSync(join(coreDir, "auth.json")))
    finish(1, `✗ Core 配置目录未落在 PRIMUS_CODING_AGENT_DIR（${coreDir}）`);
  else
    finish(
      0,
      `✓ get_state 响应正常（sessionId ${msg.data.sessionId}），配置目录为 PRIMUS_CODING_AGENT_DIR`,
    );
});

child.on("exit", (code) => {
  childExited = true;
  finish(1, `✗ Core 进程提前退出（退出码 ${code}）`);
});
child.stdin.write(`${JSON.stringify({ id: "smoke-1", type: "get_state" })}\n`);
