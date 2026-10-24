#!/usr/bin/env node
// 被禁 SDK 检查（技术方案第 6.2 节 C1、第 22.1 节第 3 步）：
// 外部模型只走 OpenAI Responses 与 Anthropic Messages，依赖图与导入图中不得出现
// Google、AWS Bedrock、Mistral 等其他供应商的 SDK。发现即以非零状态退出。
//
// 检查范围：
// 1. 依赖图：pnpm-lock.yaml 中的全部包（含传递依赖），各工作区 package.json 的全部依赖字段
// 2. 导入图：工作区源码（apps/*、packages/*、e2e、scripts）中的 import / require / import()
// 3. Agent Core（agent-core/ 存在时）：package-lock.json 中的全部包，以及构建产物 dist/ 里的导入
//
// 规则在 scripts/forbidden-sdk.json：forbidden 为被禁包名（支持 "@scope/*" 通配）；
// enforceCore 为 false 时（Core 两协议裁剪合入前），agent-core/ 中的发现只告警不失败。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXT = /\.(?:[cm]?[jt]s|tsx|jsx)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "target", "gen", ".git", ".turbo"]);
const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundleDependencies",
  "bundledDependencies",
];

/** 把规则（"@google/*"、"groq-sdk"）编译为匹配包名的函数 */
export function compileRules(rules) {
  const exact = new Set();
  const scopes = [];
  for (const rule of rules) {
    if (rule.endsWith("/*")) scopes.push(rule.slice(0, -1));
    else exact.add(rule);
  }
  return (name) => exact.has(name) || scopes.some((s) => name.startsWith(s));
}

/** 从模块说明符取包名："@a/b/c" → "@a/b"，"x/y" → "x"；相对路径、node: 内置模块返回 null */
export function packageName(specifier) {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/")) return null;
  if (specifier.startsWith("node:") || /^[a-z]+:/i.test(specifier)) return null;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0];
}

/** 源码中的模块说明符：import … from "x"、import "x"、export … from "x"、require("x")、import("x") */
export function importSpecifiers(code) {
  const out = new Set();
  const patterns = [
    /\b(?:import|export)\s[^;'"`]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) out.add(m[1]);
  return [...out];
}

/** pnpm-lock.yaml（v9）packages / snapshots 段中的包名 */
export function pnpmLockPackages(text) {
  const names = new Set();
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inSection = line === "packages:" || line === "snapshots:";
      continue;
    }
    if (!inSection) continue;
    const m = /^ {2}'?((?:@[^@/\s']+\/)?[^@\s':]+)@/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

/** npm package-lock.json（v2/v3）中的包名，包括嵌套的 node_modules */
export function npmLockPackages(lock) {
  const names = new Set();
  for (const [key, meta] of Object.entries(lock.packages ?? {})) {
    const idx = key.lastIndexOf("node_modules/");
    if (idx === -1) continue;
    names.add(meta?.name ?? key.slice(idx + "node_modules/".length));
  }
  for (const name of Object.keys(lock.dependencies ?? {})) names.add(name);
  return names;
}

function walk(dir, onFile) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, onFile);
    else onFile(p);
  }
}

function listDirs(parent) {
  if (!existsSync(parent)) return [];
  return readdirSync(parent)
    .map((d) => join(parent, d))
    .filter((p) => statSync(p).isDirectory());
}

export function run(root) {
  const config = JSON.parse(readFileSync(join(root, "scripts/forbidden-sdk.json"), "utf8"));
  const isForbidden = compileRules(config.forbidden);
  const findings = [];
  const coreWarnings = [];
  const rel = (p) => relative(root, p).split(sep).join("/");
  const report = (where, name) => {
    if (!isForbidden(name)) return;
    const inCore = where.startsWith("agent-core/");
    (inCore && !config.enforceCore ? coreWarnings : findings).push(`${where}: ${name}`);
  };
  const scanImports = (dir, { skipDist = true } = {}) =>
    walk(dir, (file) => {
      if (!SOURCE_EXT.test(file) || file.endsWith(".d.ts")) return;
      if (skipDist && file.split(sep).includes("dist")) return;
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        const name = packageName(spec);
        if (name) report(`${rel(file)}（导入）`, name);
      }
    });

  // 1. 工作区依赖图
  const workspaceDirs = [
    root,
    ...listDirs(join(root, "apps")),
    ...listDirs(join(root, "packages")),
  ];
  if (existsSync(join(root, "e2e"))) workspaceDirs.push(join(root, "e2e"));
  for (const dir of workspaceDirs) {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    for (const field of DEP_FIELDS) {
      const deps = pkg[field];
      const names = Array.isArray(deps) ? deps : Object.keys(deps ?? {});
      for (const name of names) report(`${rel(pkgPath)}（${field}）`, name);
    }
  }
  const pnpmLock = join(root, "pnpm-lock.yaml");
  if (existsSync(pnpmLock)) {
    for (const name of pnpmLockPackages(readFileSync(pnpmLock, "utf8")))
      report("pnpm-lock.yaml", name);
  }

  // 2. 工作区导入图
  for (const dir of workspaceDirs.slice(1)) scanImports(dir);
  scanImports(join(root, "scripts"));

  // 3. Agent Core
  const core = join(root, "agent-core");
  let coreChecked = false;
  if (existsSync(join(core, "package-lock.json"))) {
    coreChecked = true;
    const lock = JSON.parse(readFileSync(join(core, "package-lock.json"), "utf8"));
    for (const name of npmLockPackages(lock)) report("agent-core/package-lock.json", name);
    for (const pkgDir of listDirs(join(core, "packages"))) {
      const dist = join(pkgDir, "dist");
      if (existsSync(dist)) scanImports(dist, { skipDist: false });
    }
  }

  return { findings, coreWarnings: [...new Set(coreWarnings)], coreChecked };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { findings, coreWarnings, coreChecked } = run(root);
  if (coreWarnings.length > 0) {
    console.warn(
      `⚠ agent-core/ 中有 ${coreWarnings.length} 处被禁 SDK，待 Core 两协议裁剪后强制（enforceCore）：`,
    );
    for (const w of coreWarnings) console.warn(`  - ${w}`);
  }
  if (findings.length > 0) {
    console.error(`✗ 发现被禁 SDK（技术方案第 6.2 节）共 ${findings.length} 处：`);
    for (const f of findings) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ 依赖图与导入图中未发现被禁 SDK${coreChecked ? "（含 Agent Core）" : "（尚未引入 Agent Core）"}`,
  );
}
