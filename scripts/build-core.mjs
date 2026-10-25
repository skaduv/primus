#!/usr/bin/env node
// 构建 Agent Core（技术方案第 6.3 节）。
//
//   node scripts/build-core.mjs              npm ci + 模型数据 + 编译打包
//   node scripts/build-core.mjs --skip-install  已执行过 npm ci 时跳过安装
//
// 可复现性：
// - 依赖：只用 agent-core/package-lock.json（npm ci），HUSKY=0 防止 Core 的 prepare 脚本改动本仓库的 git hooks。
// - 产物：编译前清空各包的 dist/。tsc 不会删除已删源文件的旧产物（如裁剪掉的供应商适配器），
//   不清空会让旧文件残留在产物里，被禁 SDK 检查也会误报。
// - 模型数据：Core 构建需要内置模型目录。上游默认构建会在线抓取最新数据（每次结果不同），
//   这里改为下载 agent-core/nix/model-catalog.json 锁定的目录修订版，校验 SHA-256 后离线生成，
//   再执行 build:offline。
//
// TODO（打包阶段，第 3.2 节）：把产物复制到 dist/agent-core/，并放入校验过的 node.exe 到 dist/runtime/。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const coreDir = join(root, "agent-core");
const skipInstall = process.argv.includes("--skip-install");
const env = { ...process.env, HUSKY: "0" };

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: coreDir,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error(`✗ 命令失败（退出码 ${r.status}）：${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

async function fetchPinnedCatalog() {
  const pin = JSON.parse(readFileSync(join(coreDir, "nix/model-catalog.json"), "utf8"));
  const revision = String(pin.revision ?? "");
  const expected = revision.replace(/^sha256-/, "");
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error(`模型目录修订号格式不正确：${revision}`);

  const cacheDir = join(coreDir, ".artifacts");
  const file = join(cacheDir, `model-catalog-${expected}.json`);
  try {
    const cached = readFileSync(file);
    if (createHash("sha256").update(cached).digest("hex") === expected) return file;
  } catch {}

  // 下载地址取自 Core 自带的 nix 构建定义，与上游官方离线构建一致；修订版按字节哈希，内容恒定
  const nix = readFileSync(join(coreDir, "nix/package.nix"), "utf8");
  const template = nix.match(/url\s*=\s*"([^"]*\$\{modelCatalogPin\.revision\}[^"]*)"/)?.[1];
  if (!template) throw new Error("未在 agent-core/nix/package.nix 中找到模型目录下载地址");
  const url = template.replace(/\$\{modelCatalogPin\.revision\}/, revision);
  console.log(`\n> 下载锁定的模型目录 ${revision}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载模型目录失败：HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected)
    throw new Error(`模型目录 SHA-256 不匹配：期望 ${expected}，实际 ${actual}`);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, bytes);
  return file;
}

function cleanDist() {
  const packagesDir = join(coreDir, "packages");
  for (const name of readdirSync(packagesDir)) {
    const dist = join(packagesDir, name, "dist");
    if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
  }
}

if (!skipInstall) run("npm", ["ci", "--no-audit", "--no-fund"]);
const catalog = await fetchPinnedCatalog();
run("node", ["packages/ai/scripts/hydrate-model-catalog.ts", catalog]);
cleanDist();
run("npm", ["run", "build:offline"]);
console.log("\n✓ Agent Core 构建完成：agent-core/packages/coding-agent/dist/bundle/rpc-entry.js");
