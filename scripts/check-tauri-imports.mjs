#!/usr/bin/env node
// 平台边界检查（技术方案第 16.1.1 节）：
// 只有 apps/desktop/src/lib/platform/tauri/ 可以 import `@tauri-apps/*` 或直接访问 Tauri 注入的全局对象；
// 其他前端代码与共享包一律通过 src/lib/platform 的接口调用，保证 `pnpm dev:web` 能脱离 Rust 用 mock 运行。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** 要扫描的目录（相对仓库根） */
export const SCAN_DIRS = ["apps/desktop/src", "packages"];
/** 允许使用 Tauri API 的目录 */
export const ALLOWED_DIR = "apps/desktop/src/lib/platform/tauri/";
const EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "out", ".next", "src-tauri"]);

/** 去掉注释，避免注释里的示例代码被误报（字符串里的 // 也会被去掉，只会减少命中，不会误报） */
export function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

const PATTERNS = [
  // import x from "@tauri-apps/..."、import "@tauri-apps/..."、export … from "@tauri-apps/..."
  { re: /\b(?:import|export)\b(?!\s*\()[^;'"`]*?['"`](@tauri-apps\/[^'"`]+)['"`]/g, kind: "导入" },
  // import("@tauri-apps/...")、require("@tauri-apps/...")
  { re: /\b(?:import|require)\s*\(\s*['"`](@tauri-apps\/[^'"`]+)['"`]/g, kind: "动态导入" },
  // 直接访问 Tauri 注入的全局对象
  { re: /\b(__TAURI_INTERNALS__|__TAURI__)\b/g, kind: "全局对象" },
];

/** 返回一段代码中违反边界的位置 */
export function findViolations(code) {
  const clean = stripComments(code);
  const out = [];
  for (const { re, kind } of PATTERNS) {
    for (const m of clean.matchAll(re)) {
      const line = clean.slice(0, m.index).split("\n").length;
      out.push({ line, kind, what: m[1] });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTENSIONS.test(name)) yield full;
  }
}

/** 扫描仓库，返回违规清单（"路径:行 种类 内容"） */
export function run(root) {
  const findings = [];
  let scanned = 0;
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file).split(sep).join("/");
      scanned += 1;
      if (rel.startsWith(ALLOWED_DIR)) continue;
      for (const v of findViolations(readFileSync(file, "utf8")))
        findings.push(`${rel}:${v.line} ${v.kind} ${v.what}`);
    }
  }
  return { findings, scanned };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { findings, scanned } = run(root);
  if (findings.length > 0) {
    console.error(
      `✗ 只有 ${ALLOWED_DIR} 可以使用 Tauri API（第 16.1.1 节），发现 ${findings.length} 处越界：`,
    );
    for (const f of findings) console.error(`  - ${f}`);
    console.error("  请改为通过 src/lib/platform 的接口调用，并补上 mock/ 实现。");
    process.exit(1);
  }
  console.log(`✓ 平台边界检查通过（扫描 ${scanned} 个文件）`);
}
