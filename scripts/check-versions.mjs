#!/usr/bin/env node
// 版本基线检查（技术方案第 2.4 节）：
// 1. 工具链版本（.node-version、packageManager、rust-toolchain.toml、CI 中的 WIX / cargo-nextest / tauri-driver 版本）与基线一致
// 2. 所有 package.json 依赖（含 peerDependencies）锁定精确版本（不允许 ^ ~ * latest 等范围；仅 workspace:* 除外）
// 3. Cargo.toml 依赖一律 "=x.y.z" 精确锁定
// 4. 出现在基线中的依赖，版本必须与基线一致（尚未引入的依赖跳过）
// 5. 不允许预发布版本（alpha / beta / rc / canary / nightly / preview）
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const baseline = JSON.parse(readFileSync(join(root, "scripts/version-baseline.json"), "utf8"));
const errors = [];
const fail = (msg) => errors.push(msg);
const read = (p) => readFileSync(join(root, p), "utf8");
const PRERELEASE = /-(alpha|beta|rc|canary|nightly|preview|next)/i;
const EXACT = /^\d+\.\d+\.\d+$/;

// ---- 工具链 ----
const nodeVersion = read(".node-version").trim();
if (nodeVersion !== baseline.toolchain.node)
  fail(`.node-version 为 ${nodeVersion}，基线为 ${baseline.toolchain.node}`);

const rootPkg = JSON.parse(read("package.json"));
const pm = rootPkg.packageManager ?? "";
if (pm !== `pnpm@${baseline.toolchain.pnpm}`)
  fail(`packageManager 为 "${pm}"，基线为 pnpm@${baseline.toolchain.pnpm}`);
if (rootPkg.engines?.node !== baseline.toolchain.node)
  fail(`package.json engines.node 为 ${rootPkg.engines?.node}，基线为 ${baseline.toolchain.node}`);

const rustChannel = read("rust-toolchain.toml").match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
if (rustChannel !== baseline.toolchain.rust)
  fail(`rust-toolchain.toml channel 为 ${rustChannel}，基线为 ${baseline.toolchain.rust}`);

const cargoToml = read("apps/desktop/src-tauri/Cargo.toml");
const rustVersion = cargoToml.match(/^rust-version\s*=\s*"([^"]+)"/m)?.[1];
const expectedRustVersion = baseline.toolchain.rust.split(".").slice(0, 2).join(".");
if (rustVersion !== expectedRustVersion)
  fail(`Cargo.toml rust-version 为 ${rustVersion}，应为 ${expectedRustVersion}`);

const ci = read(".github/workflows/ci.yml");
const wix = ci.match(/WIX_VERSION:\s*"([^"]+)"/)?.[1];
if (wix !== baseline.toolchain.wix)
  fail(`ci.yml WIX_VERSION 为 ${wix}，基线为 ${baseline.toolchain.wix}`);
for (const [envName, tool] of [
  ["CARGO_NEXTEST_VERSION", "cargo-nextest"],
  ["TAURI_DRIVER_VERSION", "tauri-driver"],
]) {
  const v = ci.match(new RegExp(`${envName}:\\s*"([^"]+)"`))?.[1];
  if (v !== baseline.toolchain[tool])
    fail(`ci.yml ${envName} 为 ${v}，基线为 ${baseline.toolchain[tool]}`);
}

// ---- npm 依赖 ----
const skipDirs = new Set(["node_modules", "agent-core", ".git", "dist", "out", ".next", "target"]);
function findPackageJsons(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...findPackageJsons(full));
    else if (name === "package.json") found.push(full);
  }
  return found;
}
for (const file of findPackageJsons(root)) {
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const rel = relative(root, file);
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (spec === "workspace:*") continue;
      if (!EXACT.test(spec)) {
        fail(`${rel} ${name}@${spec} 不是精确版本`);
        continue;
      }
      const expected = baseline.npm[name];
      if (expected && spec !== expected) fail(`${rel} ${name}@${spec}，基线为 ${expected}`);
    }
  }
}

// ---- Cargo 依赖 ----
const depSection =
  /^\[((?:target\.[^\]]+\.)?(?:build-|dev-)?dependencies)\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/gm;
for (const [, section, body] of cargoToml.matchAll(depSection)) {
  for (const line of body.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{.*?version\s*=\s*"([^"]+)")/);
    if (!m) continue;
    const name = m[1];
    const spec = m[2] ?? m[3];
    if (!spec.startsWith("=") || !EXACT.test(spec.slice(1))) {
      fail(`Cargo.toml [${section}] ${name} = "${spec}" 不是 "=x.y.z" 精确版本`);
      continue;
    }
    const expected = baseline.cargo[name];
    if (expected && spec.slice(1) !== expected)
      fail(`Cargo.toml ${name} = "${spec}"，基线为 =${expected}`);
  }
}

// ---- 预发布 ----
for (const [group, entries] of Object.entries(baseline)) {
  if (group.startsWith("$")) continue;
  for (const [name, v] of Object.entries(entries))
    if (PRERELEASE.test(v)) fail(`基线 ${group}.${name} 使用了预发布版本 ${v}`);
}

if (errors.length) {
  console.error(`版本基线检查失败（${errors.length} 项）：`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("✓ 版本基线检查通过");
