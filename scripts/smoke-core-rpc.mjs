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

function finish(code, message) {
  clearTimeout(timer);
  child.kill();
  rmSync(sandbox, { recursive: true, force: true });
  if (code === 0) console.log(message);
  else console.error(`${message}\n--- Core stderr ---\n${stderr}`);
  process.exit(code);
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

child.on("exit", (code) => finish(1, `✗ Core 进程提前退出（退出码 ${code}）`));
child.stdin.write(`${JSON.stringify({ id: "smoke-1", type: "get_state" })}\n`);
