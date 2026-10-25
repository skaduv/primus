#!/usr/bin/env node
// 构建 MSI（技术方案第 3.3.1、3.3.3、3.3.4 节，第 22.1 节第 6 步）：
//
//   1. pnpm --filter @primus/desktop tauri build --no-bundle -- --locked   编译 Primus.exe（前端静态导出后嵌入）
//   2. signtool 签名 Primus.exe（配置了证书时；node.exe 保留 OpenJS 官方签名，不重签）
//   3. wix build Primus.wxs（WiX 7：-arch x64 -culture zh-CN -acceptEula wix7，
//      -bindpath app / core / runtime，-d ProductVersion=<主.次.修订.构建>）
//   4. signtool 签名 MSI（配置了证书时），写 SHA-256 校验文件
//   5. tauri signer sign 生成 updater 签名 .sig（配置了 TAURI_SIGNING_PRIVATE_KEY 时）
//
// 前提：pnpm build:core（dist/agent-core 与 dist/runtime）与 pnpm build:extensions（primus-bundle.js）已完成；
// 已安装 WiX 7 .NET 工具与 UI、Util 扩展（版本见 scripts/version-baseline.json，CI 中 `wix extension add -g`）。
// WiX 只能在 Windows 上运行；其他平台只能用 --dry-run 查看将要执行的命令。
//
// 用法：node scripts/build-msi.mjs [--version <SemVer>] [--skip-tauri] [--out-dir <目录>] [--dry-run]
//   --version   默认取 apps/desktop/src-tauri/tauri.conf.json 的 version
//   --skip-tauri 已编译好 Primus.exe 时跳过第 1 步
//   --out-dir   MSI 输出目录，默认仓库根下 out/（已在 .gitignore 中）
//
// 签名所需环境变量（证书与私钥只保存在 CI 密钥库，第 22.3 节）：
//   PRIMUS_SIGN_CERT_SHA1      代码签名证书指纹（signtool /sha1）
//   PRIMUS_SIGN_TIMESTAMP_URL  RFC 3161 时间戳服务器（signtool /tr）
//   PRIMUS_SIGNTOOL            signtool.exe 路径（默认取 PATH 中的 signtool）
//   TAURI_SIGNING_PRIVATE_KEY[/_PASSWORD]  updater 签名私钥（tauri signer 读取）
// 未配置时跳过对应签名并提示（开发与 PR 构建）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MANIFEST_FILE, verifyManifest } from "./core-dist.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const tauriDir = join(root, "apps/desktop/src-tauri");
export const WXS = join(tauriDir, "windows/Primus.wxs");
export const CULTURE = "zh-CN";
export const WIX_EXTENSIONS = ["WixToolset.UI.wixext", "WixToolset.Util.wixext"];

/**
 * SemVer → MSI ProductVersion（第 3.3.3 节）：1.2.3 → 1.2.3.0；预发布 1.3.0-beta.2 → 1.3.0.2
 * （取预发布标识中最后一个数字段）。主、次 ≤ 255，修订 ≤ 65535，构建 ≤ 65535。
 */
export function msiProductVersion(semver) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(semver);
  if (!m) throw new Error(`版本号不是 SemVer：${semver}`);
  const [major, minor, patch] = [m[1], m[2], m[3]].map(Number);
  let build = 0;
  if (m[4]) {
    const numeric = m[4].split(".").filter((p) => /^\d+$/.test(p));
    if (numeric.length === 0)
      throw new Error(`预发布版本缺少数字段，无法映射为 MSI 版本：${semver}`);
    build = Number(numeric.at(-1));
  }
  if (major > 255 || minor > 255) throw new Error(`MSI 版本的主、次版本不得超过 255：${semver}`);
  if (patch > 65535 || build > 65535)
    throw new Error(`MSI 版本的修订、构建号不得超过 65535：${semver}`);
  return `${major}.${minor}.${patch}.${build}`;
}

/** 交付物文件名（第 3.1 节）：Primus_<ver>_x64_zh-CN.msi */
export function msiFileName(semver) {
  return `Primus_${semver}_x64_${CULTURE}.msi`;
}

/** wix build 参数（第 3.3.1 节第 3 步） */
export function wixBuildArgs({ wxs = WXS, appDir, coreDir, runtimeDir, productVersion, out }) {
  return [
    "build",
    wxs,
    "-arch",
    "x64",
    "-culture",
    CULTURE,
    "-acceptEula",
    "wix7",
    ...WIX_EXTENSIONS.flatMap((ext) => ["-ext", ext]),
    "-bindpath",
    `app=${appDir}`,
    "-bindpath",
    `core=${coreDir}`,
    "-bindpath",
    `runtime=${runtimeDir}`,
    "-d",
    `ProductVersion=${productVersion}`,
    "-o",
    out,
  ];
}

/** signtool 签名参数（第 3.3.1 节第 2、4 步）；未配置证书时返回 null */
export function signtoolArgs(file, env = process.env) {
  const sha1 = env.PRIMUS_SIGN_CERT_SHA1;
  const tsa = env.PRIMUS_SIGN_TIMESTAMP_URL;
  if (!sha1 || !tsa) return null;
  return ["sign", "/fd", "sha256", "/tr", tsa, "/td", "sha256", "/sha1", sha1, file];
}

function main() {
  const { values: args } = parseArgs({
    options: {
      version: { type: "string" },
      "skip-tauri": { type: "boolean", default: false },
      "out-dir": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const dryRun = args["dry-run"];
  const isWindows = process.platform === "win32";
  if (!isWindows && !dryRun) fail("WiX 只能在 Windows 上运行；在其他平台可用 --dry-run 查看命令");

  // wix、signtool 是 exe，直接启动（参数原样传递，路径含空格与中文也无需转义）；
  // pnpm 在 Windows 上是 .cmd，Node 不允许不经 shell 启动 .cmd，只有它走 shell，路径参数加引号
  const run = (command, commandArgs, { capture = false, shell = false } = {}) => {
    console.log(`\n> ${[command, ...commandArgs].join(" ")}`);
    if (dryRun) return "";
    const r = spawnSync(command, commandArgs, {
      cwd: root,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      encoding: "utf8",
      shell,
    });
    if (r.error) fail(`无法启动 ${command}：${r.error.message}`);
    if (r.status !== 0) fail(`命令失败（退出码 ${r.status}）：${command} ${commandArgs.join(" ")}`);
    return capture ? r.stdout : "";
  };
  const [pnpm, ...pnpmPrefix] = (process.env.PRIMUS_PNPM ?? "pnpm").split(" ").filter(Boolean);
  const runPnpm = (pnpmArgs) => run(pnpm, [...pnpmPrefix, ...pnpmArgs], { shell: isWindows });
  const quoted = (p) => (isWindows ? `"${p}"` : p);

  const tauriConf = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8"));
  const version = args.version ?? tauriConf.version;
  const productVersion = msiProductVersion(version);
  const outDir = resolve(root, args["out-dir"] ?? "out");
  const msi = join(outDir, msiFileName(version));
  const targetDir = process.env.CARGO_TARGET_DIR
    ? resolve(tauriDir, process.env.CARGO_TARGET_DIR)
    : join(tauriDir, "target");
  const appDir = join(targetDir, "release");
  const coreDir = join(root, "dist/agent-core");
  const runtimeDir = join(root, "dist/runtime");
  console.log(`乾元 Primus MSI：版本 ${version} → ProductVersion ${productVersion}`);

  // 0. 前提：Core 产物与 manifest 一致、第一方扩展已打包、内置运行时就位、WiX 版本与基线一致
  if (!dryRun) {
    const manifestPath = join(coreDir, MANIFEST_FILE);
    if (!existsSync(manifestPath))
      fail("未找到 dist/agent-core/manifest.json，请先运行 pnpm build:core");
    const problems = verifyManifest(coreDir, JSON.parse(readFileSync(manifestPath, "utf8")), {
      skip: ["extensions"],
    });
    if (problems.length) fail(`dist/agent-core 与 manifest 不符：\n  ${problems.join("\n  ")}`);
    if (!existsSync(join(coreDir, "extensions/primus-bundle.js")))
      fail("未找到 dist/agent-core/extensions/primus-bundle.js，请先运行 pnpm build:extensions");
    if (!existsSync(join(runtimeDir, "node.exe")))
      fail("未找到 dist/runtime/node.exe，请先运行 pnpm build:core（--platform win-x64）");
    const baseline = JSON.parse(readFileSync(join(root, "scripts/version-baseline.json"), "utf8"));
    const wixVersion = run("wix", ["--version"], { capture: true }).trim();
    if (!wixVersion.startsWith(`${baseline.toolchain.wix}`))
      fail(`WiX 版本为 ${wixVersion}，基线为 ${baseline.toolchain.wix}（技术方案第 2.4 节）`);
  }

  // 1. 编译 Primus.exe（不打包）
  if (!args["skip-tauri"])
    runPnpm(["--filter", "@primus/desktop", "tauri", "build", "--no-bundle", "--", "--locked"]);
  const exe = join(appDir, "Primus.exe");
  if (!dryRun && !existsSync(exe)) fail(`未找到 ${exe}`);

  // 2. 签名 Primus.exe
  const signtool = process.env.PRIMUS_SIGNTOOL ?? "signtool";
  const signExe = signtoolArgs(exe);
  if (signExe) run(signtool, signExe);
  else
    console.log(
      "\n· 未配置 PRIMUS_SIGN_CERT_SHA1 / PRIMUS_SIGN_TIMESTAMP_URL，跳过 Primus.exe 签名",
    );

  // 3. WiX 7 构建 MSI
  if (!dryRun) mkdirSync(outDir, { recursive: true });
  run("wix", wixBuildArgs({ appDir, coreDir, runtimeDir, productVersion, out: msi }));

  // 4. 签名 MSI，写 SHA-256 校验文件
  const signMsi = signtoolArgs(msi);
  if (signMsi) run(signtool, signMsi);
  else console.log("\n· 未配置代码签名证书，跳过 MSI 签名");
  if (!dryRun) {
    const digest = createHash("sha256").update(readFileSync(msi)).digest("hex");
    writeFileSync(`${msi}.sha256`, `${digest}  ${basename(msi)}\n`);
  }

  // 5. updater 签名（.sig 写在 MSI 旁边）
  if (process.env.TAURI_SIGNING_PRIVATE_KEY)
    runPnpm(["--filter", "@primus/desktop", "tauri", "signer", "sign", quoted(msi)]);
  else console.log("\n· 未配置 TAURI_SIGNING_PRIVATE_KEY，跳过 updater 签名（.sig）");

  console.log(`\n✓ ${dryRun ? "（演练）" : ""}MSI：${msi}`);
  if (!dryRun) console.log(`  SHA-256：${readFileSync(`${msi}.sha256`, "utf8").split(" ")[0]}`);
  return msi;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
