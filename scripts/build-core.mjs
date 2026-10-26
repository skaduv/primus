#!/usr/bin/env node
// 构建 Agent Core 并组装 dist/（技术方案第 3.2、6.3、22.1 节）。
//
//   node scripts/build-core.mjs                    npm ci + 模型数据 + 编译打包 + 组装 dist/
//   node scripts/build-core.mjs --skip-install     已执行过 npm ci 时跳过安装
//   node scripts/build-core.mjs --skip-build       不重新编译，只用已有构建产物组装 dist/
//   node scripts/build-core.mjs --platform <p>     内置运行时平台：win-x64（默认，下载并校验 node.exe）；
//                                                  current 表示不下载（Linux/macOS 本地或 CI 冒烟时用当前 node）
//
// 可复现性：
// - 依赖：只用 agent-core/package-lock.json（npm ci --ignore-scripts），HUSKY=0 防止 Core 的 prepare 脚本改动本仓库的 git hooks。
//   锁文件中带安装脚本的包只有 esbuild 是构建所需（另行 npm rebuild esbuild）；其余是 Core 自身测试与评测用的开发依赖
//   （canvas、workerd、autoevals）或可选的原生加速（ssh2、cpu-features、fsevents）。不跳过的话，canvas 在 Windows ARM64
//   上没有预编译包、会改为本地编译并因缺少 cairo 失败；两个架构用同一套安装方式，产物与架构无关。
// - 产物：编译前清空各包的 dist/。tsc 不会删除已删源文件的旧产物（如裁剪掉的供应商适配器），
//   不清空会让旧文件残留在产物里，被禁 SDK 检查也会误报。
// - 模型数据：Core 构建需要内置模型目录。上游默认构建会在线抓取最新数据（每次结果不同），
//   这里改为下载 agent-core/nix/model-catalog.json 锁定的目录修订版，校验 SHA-256 后离线生成，
//   再执行 build:offline。
//
// 组装（产物不入库，dist/ 在 .gitignore 中）：
// - dist/agent-core/：沿用 Core npm 包的目录结构（package.json 在根，打包产物在 dist/bundle/，
//   HTML 导出模板在 dist/core/export-html/），Core 按这个结构定位自身资源；根目录另放 rpc-entry.js、
//   cli.js 两个转发入口，以及 Core 上游的 MIT 许可文件 LICENSE（agent-core/LICENSE 原样复制）。node_modules/ 只放打包时保留为外部依赖、运行时必须的少量模块的运行文件。
//   manifest.json 记录每个文件的大小与 SHA-256、Core 与外部模块的上游版本、内置运行时信息。
//   extensions/ 由 pnpm build:extensions 写入，这里保留不动，也不计入 manifest。
// - dist/runtime/：从 nodejs.org 下载 scripts/node-runtime.json 锁定版本的发行包，校验固化在仓库中的
//   SHA-256（并与官方 SHASUMS256.txt 交叉核对），只解出 node.exe 与 LICENSE；npm、文档、示例不打包。
//   node.exe 保留 OpenJS 官方 Authenticode 签名，签名验证在 Windows CI 上做。
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  assertSha256,
  buildManifest,
  copyCoreLicense,
  listFiles,
  listZipEntries,
  MANIFEST_FILE,
  parseShasums,
  pickFiles,
  readZipEntry,
  runtimePackageJson,
  selectRuntimeEntries,
  sha256,
} from "./core-dist.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const coreDir = join(root, "agent-core");
const corePackageDir = join(coreDir, "packages/coding-agent");
const distCore = join(root, "dist/agent-core");
const distRuntime = join(root, "dist/runtime");
const { values: args } = parseArgs({
  options: {
    "skip-install": { type: "boolean", default: false },
    "skip-build": { type: "boolean", default: false },
    platform: { type: "string", default: "win-x64" },
  },
});
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
    if (sha256(cached) === expected) return file;
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
  assertSha256(bytes, expected, "模型目录");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, bytes);
  return file;
}

function cleanPackageDist() {
  const packagesDir = join(coreDir, "packages");
  for (const name of readdirSync(packagesDir)) {
    const dist = join(packagesDir, name, "dist");
    if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
  }
}

// ---- 组装 dist/agent-core ----

// 运行时需要的 Core 产物（相对 agent-core/packages/coding-agent，按原路径复制）
const CORE_FILES = [
  "dist/bundle/**",
  "dist/core/export-html/template.html",
  "dist/core/export-html/template.css",
  "dist/core/export-html/template.js",
  "dist/core/export-html/vendor/*.js",
];
// 打包时保留为外部依赖、运行时必须的模块（相对 agent-core/node_modules/<模块>）：
// - photon-node：图片处理（含 photon_rs_bg.wasm），打包脚本将其保留为外部依赖
// - jiti：加载扩展时才按需 require
// - quickjs-wasi：JS 已打包，代码执行沙箱在运行时按包路径解析 quickjs.wasm
// 可选的原生加速模块（bufferutil 等）缺失时有回退，不打包。每个模式都必须至少匹配一个文件，
// 上游调整文件布局时构建直接失败，而不是装出缺文件的产物。
const EXTERNAL_MODULES = {
  "@silvia-odwyer/photon-node": [
    "package.json",
    "LICENSE.md",
    "photon_rs.js",
    "photon_rs_bg.js",
    "photon_rs_bg.wasm",
  ],
  jiti: ["package.json", "LICENSE", "lib/*.cjs", "lib/*.mjs", "dist/*.cjs"],
  "quickjs-wasi": ["package.json", "LICENSE", "quickjs.wasm"],
};
// 根目录转发入口：薄壳按 <安装目录>\resources\agent-core\rpc-entry.js 启动（第 5.3 节）
const LAUNCHERS = {
  "rpc-entry.js": "./dist/bundle/rpc-entry.js",
  "cli.js": "./dist/bundle/cli.js",
};
// 由其他步骤写入 dist/agent-core 的目录：组装时保留，manifest 不收录
const PRESERVED = ["extensions"];

function copyFile(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function copyPicked(srcDir, destDir, patterns, label) {
  const all = listFiles(srcDir);
  for (const pattern of patterns) {
    if (pickFiles(all, [pattern]).length === 0)
      throw new Error(`${label}：没有文件匹配 ${pattern}（构建产物不完整或上游布局有变）`);
  }
  const picked = pickFiles(all, patterns);
  for (const f of picked) copyFile(join(srcDir, f), join(destDir, f));
  return picked.length;
}

function gitCommit(path) {
  const r = spawnSync("git", ["log", "-1", "--format=%H", "--", path], {
    cwd: root,
    encoding: "utf8",
  });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

function assembleCore() {
  const entry = join(corePackageDir, "dist/bundle/rpc-entry.js");
  if (!existsSync(entry)) throw new Error(`未找到 ${entry}，请先完整构建（去掉 --skip-build）`);

  // 清空 dist/agent-core，保留其他步骤写入的目录
  if (existsSync(distCore)) {
    for (const name of readdirSync(distCore)) {
      if (!PRESERVED.includes(name)) rmSync(join(distCore, name), { recursive: true, force: true });
    }
  }
  mkdirSync(distCore, { recursive: true });

  const count = copyPicked(corePackageDir, distCore, CORE_FILES, "Core 产物");
  const pkg = JSON.parse(readFileSync(join(corePackageDir, "package.json"), "utf8"));
  writeFileSync(
    join(distCore, "package.json"),
    `${JSON.stringify(runtimePackageJson(pkg), null, 2)}\n`,
  );

  const externals = {};
  for (const [name, patterns] of Object.entries(EXTERNAL_MODULES)) {
    const src = join(coreDir, "node_modules", name);
    if (!existsSync(join(src, "package.json"))) throw new Error(`未找到外部模块 ${name}`);
    copyPicked(src, join(distCore, "node_modules", name), patterns, `外部模块 ${name}`);
    externals[name] = JSON.parse(readFileSync(join(src, "package.json"), "utf8")).version;
  }

  // Core 上游 MIT 许可：放在 dist/agent-core 根目录，计入 manifest，随 MSI 安装到 resources\agent-core\LICENSE
  copyCoreLicense(coreDir, distCore);

  for (const [file, target] of Object.entries(LAUNCHERS)) {
    const dest = join(distCore, file);
    writeFileSync(
      dest,
      `#!/usr/bin/env node\n// 转发入口（scripts/build-core.mjs 生成）：Core 按包内目录结构定位资源，产物保留在 dist/bundle/ 下\nimport "${target}";\n`,
    );
    chmodSync(dest, 0o755);
  }
  console.log(`\n✓ 已组装 dist/agent-core（Core 产物 ${count} 个文件）`);
  return { version: pkg.version, externals };
}

// ---- 下载并校验内置 Node.js 运行时 ----

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function prepareRuntime(platform) {
  rmSync(distRuntime, { recursive: true, force: true });
  if (platform === "current") {
    console.log("\n· --platform current：不下载内置运行时，冒烟用当前 node");
    return null;
  }
  const config = JSON.parse(readFileSync(join(root, "scripts/node-runtime.json"), "utf8"));
  const target = config.platforms?.[platform];
  if (!target)
    throw new Error(
      `不支持的平台 ${platform}（可选：${Object.keys(config.platforms ?? {}).join("、")}、current）`,
    );
  const { version, distUrl } = config;
  const base = `${distUrl}/v${version}`;

  // 缓存到 node_modules/.cache（已被 .gitignore 忽略）；缓存内容同样要过固化的哈希
  const cacheDir = join(root, "node_modules/.cache/primus-runtime");
  const cached = join(cacheDir, target.archive);
  let zip = existsSync(cached) ? readFileSync(cached) : null;
  if (!zip || sha256(zip) !== target.sha256) {
    // 官方 SHASUMS256.txt 与仓库固化的哈希必须一致，防止锁定值被改错或上游重发
    const sums = parseShasums((await download(`${base}/SHASUMS256.txt`)).toString("utf8"));
    if (sums.get(target.archive) !== target.sha256)
      throw new Error(
        `node-runtime.json 中 ${target.archive} 的哈希与官方 SHASUMS256.txt 不一致（官方 ${sums.get(target.archive) ?? "无此文件"}）`,
      );
    console.log(`\n> 下载 ${base}/${target.archive}`);
    zip = await download(`${base}/${target.archive}`);
    assertSha256(zip, target.sha256, target.archive);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cached, zip);
  }

  const topDir = target.archive.replace(/\.zip$/, "");
  const wanted = Object.keys(target.files);
  const picked = selectRuntimeEntries(listZipEntries(zip), topDir, wanted);
  mkdirSync(distRuntime, { recursive: true });
  const files = {};
  for (const [name, entry] of picked) {
    const bytes = readZipEntry(zip, entry);
    assertSha256(bytes, target.files[name], `${target.archive}/${name}`);
    writeFileSync(join(distRuntime, name), bytes);
    files[name] = target.files[name];
  }
  console.log(
    `✓ 已校验并解出 Node.js v${version}（${platform}）：${wanted.join("、")} → dist/runtime/`,
  );
  return {
    platform,
    version,
    archive: target.archive,
    archiveSha256: target.sha256,
    source: `${base}/${target.archive}`,
    files,
  };
}

function dirSize(dir) {
  let total = 0;
  for (const f of listFiles(dir)) total += statSync(join(dir, f)).size;
  return total;
}

// ---- 主流程 ----

if (!args["skip-build"]) {
  if (!args["skip-install"]) {
    run("npm", ["ci", "--no-audit", "--no-fund", "--ignore-scripts"]);
    run("npm", ["rebuild", "esbuild"]);
  }
  const catalog = await fetchPinnedCatalog();
  run("node", ["packages/ai/scripts/hydrate-model-catalog.ts", catalog]);
  cleanPackageDist();
  run("npm", ["run", "build:offline"]);
  console.log("\n✓ Agent Core 构建完成");
}

const core = assembleCore();
const runtime = await prepareRuntime(args.platform);
const manifest = buildManifest(
  distCore,
  {
    core: { version: core.version, sourceCommit: gitCommit("agent-core") },
    externals: core.externals,
    builtWith: { node: process.versions.node },
    runtime,
  },
  PRESERVED,
);
writeFileSync(join(distCore, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

const mib = (n) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
console.log(`\n✓ dist/agent-core：${manifest.files.length} 个文件，${mib(dirSize(distCore))}`);
if (runtime) console.log(`✓ dist/runtime：${mib(dirSize(distRuntime))}`);
