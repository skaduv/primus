// 导入图解析（技术方案第 6.2 节第 2 条、第 22.1 节第 3 步）：
// 从入口文件出发，按 Node.js 的解析规则逐个解析 import / export … from / require() / import() 的
// 字面量说明符，沿实际会被加载（或被打包进产物）的文件递归遍历，记录图中出现的每个 npm 包
// 以及从入口到该包的第一条导入链。与逐文件 grep 不同，这里能发现经由第三方包传递引入的被禁 SDK，
// 也不会把未被任何入口引用的死文件算进来。
//
// 解析规则（够用的子集）：
// - 相对 / 绝对路径：原样、补扩展名（.ts/.tsx/.mts/.cts/.js/.mjs/.cjs/.jsx/.json）、TS 源码里写成 .js 的
//   说明符换成 .ts/.tsx、目录取 package.json 的入口或 index.*
// - 别名：aliases 中的前缀（如 "@/" → apps/desktop/src/）
// - 包：从导入方所在目录逐级向上找 node_modules/<包名>（跟随 pnpm 与 npm 工作区的符号链接），
//   入口按 package.json 的 exports（条件 node / import / require / module / default，含 "*" 子路径模式）、
//   module、main、index.js 的顺序解析
// - node: 与内置模块跳过；仅类型的导入（import type / export type）不是运行时依赖，跳过
// - 非字面量的动态导入无法静态解析，不在图中；打包产物另行从产物入口遍历一遍作补充
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.replace(/^node:/, "")]));
const PARSE_EXT = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);
const TRY_EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx", ".json"];
const TS_FOR_JS = { ".js": [".ts", ".tsx"], ".mjs": [".mts"], ".cjs": [".cts"], ".jsx": [".tsx"] };
// 合法的模块说明符：不含空白、引号、逗号、括号等（排除正则在压缩代码里误配出的片段）
const VALID_SPECIFIER = /^[^\s"'`,;(){}[\]<>|\\=&!?]+$/;
// npm 包名（含 scope）
const PACKAGE_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;
const CONDITIONS = new Set(["node", "import", "require", "module", "default"]);

/**
 * 去掉整行注释（以 //、/*、* 开头的行）。只按行处理：完整的注释剥离需要区分正则字面量，
 * 在压缩产物里做错会吞掉大段代码、漏掉导入（漏报比误报更危险），所以行内注释保留原样。
 */
export function stripLineComments(code) {
  return code
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

/** 运行时导入说明符：import … from、import "x"、export … from、require("x")、import("x")；跳过仅类型导入 */
export function runtimeImports(code) {
  const src = stripLineComments(code);
  const out = new Set();
  // 字符串用同一种引号闭合（命名反向引用），避免在压缩产物里从一个字符串的引号匹配到另一个字符串
  const str = String.raw`(?<q>["'])(?<spec>(?:(?!\k<q>)[^\n\\])+)\k<q>`;
  const patterns = [
    new RegExp(
      String.raw`(?<![\w$.])(?:import|export)\s*(?<type>type\s+)?(?<clause>[\w$*{}\s,]*?)\s*from\s*${str}`,
      "g",
    ),
    new RegExp(String.raw`(?<![\w$.])import\s*${str}`, "g"),
    new RegExp(String.raw`(?<![\w$.])(?:require|import)\s*\(\s*${str}\s*\)`, "g"),
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const { type, clause, spec } = m.groups;
      // import type … / export type … 不是运行时依赖（"import type from" 是名为 type 的默认导入）
      if (type && clause.trim() !== "") continue;
      if (VALID_SPECIFIER.test(spec)) out.add(spec);
    }
  }
  return [...out];
}

/** "@a/b/c" → { name: "@a/b", subpath: "./c" }；"x" → { name: "x", subpath: "." } */
export function splitPackageSpecifier(spec) {
  const parts = spec.split("/");
  const count = spec.startsWith("@") ? 2 : 1;
  if (parts.length < count || !parts[0] || (count === 2 && !parts[1])) return null;
  const name = parts.slice(0, count).join("/");
  if (!PACKAGE_NAME.test(name)) return null;
  const rest = parts.slice(count).join("/");
  return { name, subpath: rest ? `./${rest}` : "." };
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** 解析 exports 的条件对象 / 数组 / 字符串，返回目标相对路径或 null */
function pickTarget(target) {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const t of target) {
      const r = pickTarget(t);
      if (r) return r;
    }
    return null;
  }
  if (target && typeof target === "object") {
    for (const [key, value] of Object.entries(target)) {
      if (!CONDITIONS.has(key)) continue;
      const r = pickTarget(value);
      if (r) return r;
    }
  }
  return null;
}

/** 按 package.json exports 把子路径（"." / "./x"）映射到包内相对路径 */
export function resolveExports(exportsField, subpath) {
  if (exportsField == null) return null;
  const isSubpathMap =
    typeof exportsField === "object" &&
    !Array.isArray(exportsField) &&
    Object.keys(exportsField).some((k) => k.startsWith(".") || k.startsWith("#"));
  const map = isSubpathMap ? exportsField : { ".": exportsField };
  if (Object.hasOwn(map, subpath)) return pickTarget(map[subpath]);
  let best = null;
  for (const key of Object.keys(map)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    if (subpath.length < prefix.length + suffix.length) continue;
    if (!best || prefix.length > best.prefix.length) best = { key, prefix, suffix };
  }
  if (!best) return null;
  const target = pickTarget(map[best.key]);
  if (!target) return null;
  const middle = subpath.slice(best.prefix.length, subpath.length - best.suffix.length);
  return target.replaceAll("*", middle);
}

function resolveFile(p, fromTs) {
  if (isFile(p)) return p;
  const ext = extname(p);
  if (fromTs && TS_FOR_JS[ext]) {
    for (const alt of TS_FOR_JS[ext]) {
      const q = p.slice(0, -ext.length) + alt;
      if (isFile(q)) return q;
    }
  }
  for (const e of TRY_EXT) if (isFile(p + e)) return p + e;
  if (isDir(p)) {
    const pkg = readJson(join(p, "package.json"));
    for (const field of [pkg?.module, pkg?.main]) {
      if (typeof field !== "string") continue;
      const r = resolveFile(join(p, field), false);
      if (r) return r;
    }
    for (const e of TRY_EXT) if (isFile(join(p, `index${e}`))) return join(p, `index${e}`);
  }
  return null;
}

function findPackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolvePackageEntry(pkgDir, subpath) {
  const pkg = readJson(join(pkgDir, "package.json")) ?? {};
  if (pkg.exports != null) {
    const target = resolveExports(pkg.exports, subpath);
    if (target) return resolveFile(join(pkgDir, target), false);
  }
  if (subpath === ".") return resolveFile(pkgDir, false);
  return resolveFile(join(pkgDir, subpath), false);
}

function safeRealpath(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** 包内私有导入（package.json 的 "imports"，说明符以 # 开头）：映射后按相对路径或包名继续解析 */
function resolveSubpathImport(spec, fromFile, aliases) {
  let dir = dirname(fromFile);
  for (;;) {
    const pkg = readJson(join(dir, "package.json"));
    if (pkg) {
      const target = resolveExports(pkg.imports ?? null, spec);
      if (!target) return { kind: "unresolved" };
      if (target.startsWith("./")) {
        const file = resolveFile(join(dir, target), false);
        return file ? { kind: "file", file: safeRealpath(file) } : { kind: "unresolved" };
      }
      return resolveSpecifier(target, join(dir, "package.json"), { aliases });
    }
    const parent = dirname(dir);
    if (parent === dir) return { kind: "unresolved" };
    dir = parent;
  }
}

/**
 * 解析一个说明符。返回：
 * - { kind: "builtin" }
 * - { kind: "file", file }                              相对路径或别名，解析到文件
 * - { kind: "package", name, file }                     npm 包；file 为 null 表示包存在但入口无法解析
 * - { kind: "missing-package", name }                   node_modules 中找不到该包
 * - { kind: "unresolved" }                              相对路径找不到文件
 */
export function resolveSpecifier(spec, fromFile, { aliases = {} } = {}) {
  if (spec.startsWith("node:") || BUILTINS.has(spec) || BUILTINS.has(spec.split("/")[0]))
    return { kind: "builtin" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec) && !/^[a-z]:[\\/]/i.test(spec)) return { kind: "builtin" };
  const fromTs = /\.[cm]?tsx?$/.test(fromFile);
  for (const [prefix, target] of Object.entries(aliases)) {
    if (spec.startsWith(prefix)) {
      const file = resolveFile(join(target, spec.slice(prefix.length)), true);
      return file ? { kind: "file", file: safeRealpath(file) } : { kind: "unresolved" };
    }
  }
  if (spec.startsWith(".") || isAbsolute(spec)) {
    const file = resolveFile(resolve(dirname(fromFile), spec), fromTs);
    return file ? { kind: "file", file: safeRealpath(file) } : { kind: "unresolved" };
  }
  if (spec.startsWith("#")) return resolveSubpathImport(spec, fromFile, aliases);
  const parsed = splitPackageSpecifier(spec);
  if (!parsed) return { kind: "unresolved" };
  const pkgDir = findPackageDir(parsed.name, dirname(fromFile));
  if (!pkgDir) return { kind: "missing-package", name: parsed.name };
  const file = resolvePackageEntry(safeRealpath(pkgDir), parsed.subpath);
  return { kind: "package", name: parsed.name, file: file ? safeRealpath(file) : null };
}

/**
 * 从入口遍历导入图。
 * @param {string[]} entries 入口文件（绝对路径）
 * @param {{ aliases?: Record<string,string>, followPackages?: boolean, root?: string }} options
 *   followPackages：是否继续遍历第三方包内部（默认 true，用于发现传递引入）
 * @returns {{ files: number, packages: Map<string, string[]>, missing: Map<string, string[]>, unresolved: string[] }}
 *   packages / missing：包名 → 第一次到达该包的导入链（文件路径与说明符交替）
 */
export function walkImportGraph(entries, options = {}) {
  const { aliases = {}, followPackages = true } = options;
  const seen = new Set();
  const packages = new Map();
  const missing = new Map();
  const unresolved = [];
  const queue = [];
  for (const entry of entries) {
    const file = safeRealpath(entry);
    if (!seen.has(file)) {
      seen.add(file);
      queue.push({ file, chain: [file] });
    }
  }
  while (queue.length > 0) {
    const { file, chain } = queue.shift();
    if (!PARSE_EXT.has(extname(file)) || file.endsWith(".d.ts")) continue;
    let code;
    try {
      code = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const inPackage = file.split(sep).includes("node_modules");
    for (const spec of runtimeImports(code)) {
      const r = resolveSpecifier(spec, file, { aliases: inPackage ? {} : aliases });
      if (r.kind === "builtin") continue;
      if (r.kind === "unresolved") {
        if (!inPackage) unresolved.push(`${file}: ${spec}`);
        continue;
      }
      if (r.kind === "missing-package") {
        if (!missing.has(r.name)) missing.set(r.name, [...chain, spec]);
        continue;
      }
      if (r.kind === "package" && !packages.has(r.name)) packages.set(r.name, [...chain, spec]);
      if (!r.file || seen.has(r.file)) continue;
      const isThirdParty = r.file.split(sep).includes("node_modules");
      if (isThirdParty && !followPackages) continue;
      seen.add(r.file);
      queue.push({ file: r.file, chain: [...chain, spec, r.file] });
    }
  }
  return { files: seen.size, packages, missing, unresolved };
}
