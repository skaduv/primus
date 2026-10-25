#!/usr/bin/env node
// 被禁 SDK 检查（技术方案第 6.2 节 C1、第 22.1 节第 3 步）：
// 外部模型只走 OpenAI Responses 与 Anthropic Messages，依赖图与导入图中不得出现
// Google、AWS Bedrock、Mistral 等其他供应商的 SDK。发现即以非零状态退出。
//
// 检查范围：
// 1. 依赖图：pnpm-lock.yaml 中的全部包（含传递依赖），各工作区 package.json 的全部依赖字段
// 2. 源码扫描：工作区源码（apps/*、packages/*、e2e、scripts）中逐文件出现的 import / require / import()
// 3. Agent Core（agent-core/ 存在时）：package-lock.json 中的全部包，以及各包构建产物 dist/ 里的导入
// 4. 导入图（scripts/import-graph.mjs）：从前端页面、第一方扩展、Core 打包前入口与 dist/agent-core 产物入口
//    出发，按 Node.js 解析规则沿实际加载的文件递归遍历（含第三方包内部），能发现经由其他包传递引入、
//    最终会被打进产物的被禁 SDK
// 5. SBOM：scripts/generate-sbom.mjs 生成的 CycloneDX（pnpm 工作区、agent-core npm 依赖）中的全部组件
//
// 用法：
//   node scripts/check-forbidden-sdk.mjs             第 1～5 项；尚未构建的导入图入口、尚未生成的 SBOM 跳过并提示
//   node scripts/check-forbidden-sdk.mjs --strict    CI 在 build:core、build:extensions、build:sbom 之后使用：
//                                                    配置中的每个导入图入口与 SBOM 都必须存在，缺失即失败
//   node scripts/check-forbidden-sdk.mjs --self-test 负向自检：在临时目录里分别经导入图（传递引入）与 SBOM
//                                                    引入被禁 SDK，确认本脚本以非零状态退出；干净夹具须通过
//   --root <dir>                                     检查指定目录（自检与单测用），默认仓库根
//
// 规则在 scripts/forbidden-sdk.json：forbidden 为被禁包名（支持 "@scope/*" 通配）；
// enforceCore 为 false 时（Core 两协议裁剪合入前），agent-core/ 中的发现只告警不失败；
// importGraph 为导入图入口（glob，相对仓库根）；sbom 为 SBOM 目录与必需的文件。
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { globToRegExp } from "./core-dist.mjs";
import { walkImportGraph } from "./import-graph.mjs";

const SOURCE_EXT = /\.(?:[cm]?[jt]s|tsx|jsx)$/;
// 导入图里不计入"无法解析"的非脚本资源
const ASSET_IMPORT_EXT = new Set(
  ".css .scss .sass .less .svg .png .jpg .jpeg .gif .webp .avif .ico .woff .woff2 .ttf .otf .wasm .node .html .md .txt".split(
    " ",
  ),
);
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

/** CycloneDX SBOM 中的组件包名（优先取 purl，兼容 pnpm 与 npm 的输出；递归包含嵌套组件） */
export function sbomPackages(bom) {
  if (bom?.bomFormat !== "CycloneDX") throw new Error("不是 CycloneDX 格式的 SBOM");
  const out = [];
  const visit = (components) => {
    for (const c of components ?? []) {
      let name = null;
      const purl =
        typeof c.purl === "string" ? /^pkg:npm\/(.+?)@[^@/]*(?:[?#].*)?$/.exec(c.purl) : null;
      if (purl) name = decodeURIComponent(purl[1]);
      else if (c.name) name = c.group && !c.name.startsWith("@") ? `${c.group}/${c.name}` : c.name;
      if (name) out.push({ name, version: c.version ?? "" });
      visit(c.components);
    }
  };
  visit(bom.components);
  return out;
}

/** 把相对仓库根的 glob 展开为文件列表（exclude 同为 glob）；glob 前缀目录不存在时返回空 */
export function expandEntries(root, patterns, exclude = []) {
  const files = new Set();
  const excludes = exclude.map(globToRegExp);
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      if (existsSync(join(root, pattern))) files.add(pattern);
      continue;
    }
    const base = pattern.slice(0, pattern.indexOf("*")).replace(/[^/]*$/, "");
    const baseDir = join(root, base);
    if (!existsSync(baseDir)) continue;
    const re = globToRegExp(pattern);
    walk(baseDir, (file) => {
      const r = relative(root, file).split(sep).join("/");
      if (re.test(r) && !excludes.some((x) => x.test(r))) files.add(r);
    });
  }
  return [...files].sort();
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

export function run(rootDir, { strict = false } = {}) {
  // 导入图返回的是真实路径（跟随符号链接），根目录同样取真实路径，相对路径才一致（如 macOS 的 /tmp）
  const root = realpathSync(rootDir);
  const config = JSON.parse(readFileSync(join(root, "scripts/forbidden-sdk.json"), "utf8"));
  const isForbidden = compileRules(config.forbidden);
  const findings = [];
  const coreWarnings = [];
  const rel = (p) => relative(root, p).split(sep).join("/");
  const report = (where, name, inCore = where.startsWith("agent-core/")) => {
    if (!isForbidden(name)) return;
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

  // 4. 导入图：从入口沿实际加载的文件遍历
  const graphs = [];
  const skipped = [];
  const chainText = (chain) => chain.map((p, i) => (i % 2 === 0 ? rel(p) : `「${p}」`)).join(" → ");
  for (const graph of config.importGraph ?? []) {
    // 逐个入口检查：缺失的精确路径计入缺失入口（required 或严格模式下失败）；无匹配的 glob 单独提示
    // （常见于预留的 **/*.ts 这类模式），整张图一个入口都没有时同样按缺失处理；其余入口照常遍历
    const entries = expandEntries(root, graph.entries, graph.exclude);
    const unmatched = graph.entries.filter(
      (e) => expandEntries(root, [e], graph.exclude).length === 0,
    );
    const missingEntries =
      entries.length === 0 ? unmatched : unmatched.filter((e) => !e.includes("*"));
    const emptyGlobs = unmatched.filter((e) => !missingEntries.includes(e));
    const hint = graph.hint ? `（${graph.hint}）` : "";
    if (missingEntries.length > 0) {
      const what = `${graph.name}：入口 ${missingEntries.join("、")} 不存在`;
      if (graph.required || strict) findings.push(`导入图 ${what}${hint}`);
      else skipped.push(`${what}${hint}`);
    }
    if (emptyGlobs.length > 0)
      skipped.push(`${graph.name}：入口模式 ${emptyGlobs.join("、")} 无匹配文件`);
    if (entries.length === 0) continue;
    const aliases = Object.fromEntries(
      Object.entries(graph.aliases ?? {}).map(([k, v]) => [k, `${join(root, v)}${sep}`]),
    );
    const result = walkImportGraph(
      entries.map((e) => join(root, e)),
      { aliases },
    );
    const inCore = Boolean(graph.core);
    for (const [name, chain] of result.packages)
      report(`导入图 ${graph.name}：${chainText(chain)}`, name, inCore);
    for (const [name, chain] of result.missing)
      report(`导入图 ${graph.name}（未安装）：${chainText(chain)}`, name, inCore);
    // 第一方文件里解析不到的脚本导入（别名未配置、扩展名不在尝试列表等）会让子图漏遍历，计数并输出；
    // .css 等非脚本资源不计
    const unresolved = result.unresolved.filter((u) => {
      const ext = extname(u.slice(u.lastIndexOf(": ") + 2).replace(/[?#].*$/, ""));
      return !ASSET_IMPORT_EXT.has(ext.toLowerCase());
    });
    graphs.push({
      name: graph.name,
      entries: entries.length,
      files: result.files,
      packages: result.packages.size,
      unresolved: unresolved.map((u) => {
        const i = u.lastIndexOf(": ");
        return `${rel(u.slice(0, i))}: ${u.slice(i + 2)}`;
      }),
    });
  }

  // 5. SBOM（CycloneDX）
  const sboms = [];
  if (config.sbom) {
    const dir = join(root, config.sbom.dir);
    for (const file of config.sbom.required ?? []) {
      if (!existsSync(join(dir, file))) {
        const what = `SBOM ${config.sbom.dir}/${file} 不存在（先运行 pnpm build:sbom）`;
        if (strict) findings.push(what);
        else skipped.push(what);
      }
    }
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".cdx.json")) : [];
    for (const file of files.sort()) {
      let components;
      try {
        components = sbomPackages(JSON.parse(readFileSync(join(dir, file), "utf8")));
      } catch (e) {
        findings.push(`SBOM ${config.sbom.dir}/${file} 无法解析：${e.message}`);
        continue;
      }
      const inCore = (config.sbom.core ?? []).includes(file);
      for (const c of components)
        report(`SBOM ${config.sbom.dir}/${file}（${c.version}）`, c.name, inCore);
      sboms.push({ file, components: components.length });
    }
  }

  return {
    findings: [...new Set(findings)],
    coreWarnings: [...new Set(coreWarnings)],
    coreChecked,
    graphs,
    sboms,
    skipped,
  };
}

// ---- 负向自检 ----

/**
 * 在临时目录里构造夹具：clean 为干净工作区；viaGraph 让被禁 SDK 只经第三方包传递引入（源码扫描看不到，
 * 只有导入图能发现）；viaSbom 只在 SBOM 中出现。返回夹具根目录。
 */
export function writeSelfTestFixture(kind, forbiddenName) {
  const root = mkdtempSync(join(tmpdir(), `primus-forbidden-${kind}-`));
  const files = {
    "package.json": JSON.stringify({ name: "fixture", private: true }),
    "scripts/forbidden-sdk.json": JSON.stringify({
      forbidden: [forbiddenName],
      enforceCore: true,
      importGraph: [{ name: "前端", entries: ["apps/web/src/app/**/*.tsx"], required: true }],
      sbom: { dir: "dist/sbom", required: ["workspace.cdx.json"] },
    }),
    "apps/web/package.json": JSON.stringify({
      name: "web",
      dependencies: { "chart-kit": "1.0.0" },
    }),
    "apps/web/src/app/page.tsx":
      'import { draw } from "chart-kit";\nexport default function Page() { return draw(); }\n',
    "apps/web/node_modules/chart-kit/package.json": JSON.stringify({
      name: "chart-kit",
      exports: { ".": { import: "./index.js" } },
    }),
    "apps/web/node_modules/chart-kit/index.js":
      kind === "graph"
        ? `import { client } from "${forbiddenName}";\nexport const draw = () => client;\n`
        : "export const draw = () => null;\n",
    [`apps/web/node_modules/${forbiddenName}/package.json`]: JSON.stringify({
      name: forbiddenName,
      main: "index.js",
    }),
    [`apps/web/node_modules/${forbiddenName}/index.js`]: "exports.client = {};\n",
    "dist/sbom/workspace.cdx.json": JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [
        { type: "library", name: "chart-kit", version: "1.0.0", purl: "pkg:npm/chart-kit@1.0.0" },
        ...(kind === "sbom"
          ? [
              {
                type: "library",
                name: forbiddenName,
                version: "9.9.9",
                purl: `pkg:npm/${forbiddenName.replace("@", "%40")}@9.9.9`,
              },
            ]
          : []),
      ],
    }),
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function selfTest(scriptPath) {
  // 被禁包名取自规则文件的第一条精确包名（"@scope/*" 通配取 scope 下一个虚构包名）
  const config = JSON.parse(readFileSync(join(dirname(scriptPath), "forbidden-sdk.json"), "utf8"));
  const first = config.forbidden[0];
  const forbiddenName = first.endsWith("/*") ? `${first.slice(0, -1)}fixture-sdk` : first;
  const cases = [
    { kind: "clean", expectFail: false },
    { kind: "graph", expectFail: true, mark: "导入图" },
    { kind: "sbom", expectFail: true, mark: "SBOM" },
  ];
  let ok = true;
  for (const c of cases) {
    const root = writeSelfTestFixture(c.kind, forbiddenName);
    try {
      const r = spawnSync(process.execPath, [scriptPath, "--root", root, "--strict"], {
        encoding: "utf8",
      });
      const output = `${r.stdout}${r.stderr}`;
      const failed = r.status !== 0;
      const pass = c.expectFail
        ? failed && output.includes(c.mark) && output.includes(forbiddenName)
        : !failed;
      console.log(
        `${pass ? "✓" : "✗"} 自检 ${c.kind}：退出码 ${r.status}${c.expectFail ? "（期望非 0）" : "（期望 0）"}`,
      );
      if (!pass) {
        ok = false;
        console.log(output);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  return ok;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const scriptPath = fileURLToPath(import.meta.url);
  const { values: args } = parseArgs({
    options: {
      strict: { type: "boolean", default: false },
      "self-test": { type: "boolean", default: false },
      root: { type: "string" },
    },
  });
  if (args["self-test"]) {
    const ok = selfTest(scriptPath);
    console.log(ok ? "✓ 负向自检通过：引入被禁 SDK 时检查以非零状态退出" : "✗ 负向自检失败");
    process.exit(ok ? 0 : 1);
  }
  const root = args.root ? resolve(args.root) : fileURLToPath(new URL("..", import.meta.url));
  const { findings, coreWarnings, coreChecked, graphs, sboms, skipped } = run(root, {
    strict: args.strict,
  });
  for (const g of graphs) {
    console.log(
      `· 导入图 ${g.name}：${g.entries} 个入口，遍历 ${g.files} 个文件，涉及 ${g.packages} 个包，${g.unresolved.length} 个无法解析的导入`,
    );
    for (const u of g.unresolved.slice(0, 10)) console.warn(`  ⚠ 无法解析：${u}`);
    if (g.unresolved.length > 10) console.warn(`  ⚠ ……另有 ${g.unresolved.length - 10} 个`);
  }
  for (const b of sboms) console.log(`· SBOM ${b.file}：${b.components} 个组件`);
  for (const s of skipped) console.warn(`⚠ 跳过 ${s}`);
  if (coreWarnings.length > 0) {
    console.warn(
      `⚠ agent-core/ 中有 ${coreWarnings.length} 处被禁 SDK，待 Core 两协议裁剪后强制（enforceCore）：`,
    );
    for (const w of coreWarnings) console.warn(`  - ${w}`);
  }
  if (findings.length > 0) {
    console.error(`✗ 发现被禁 SDK 或检查前提缺失（技术方案第 6.2 节）共 ${findings.length} 处：`);
    for (const f of findings) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ 依赖图、导入图与 SBOM 中未发现被禁 SDK${coreChecked ? "（含 Agent Core）" : "（尚未引入 Agent Core）"}${args.strict ? "（严格模式）" : ""}`,
  );
}
