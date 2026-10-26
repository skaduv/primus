#!/usr/bin/env node
// 构建 MSI（技术方案第 3.3.1、3.3.3、3.3.4 节，第 22.1 节第 6 步）：
//
//   1. pnpm --filter @primus/desktop tauri build --no-bundle -- --locked   编译 Primus.exe（前端静态导出后嵌入）
//   2. signtool 签名 Primus.exe（配置了证书时；node.exe 保留 OpenJS 官方签名，不重签）
//   3. wix build Primus.wxs（WiX 7：-arch x64 -culture zh-CN -acceptEula wix7，
//      -bindpath app / core / runtime，-d ProductVersion=<主.次.修订.构建>，
//      -d ShellDir=<src-tauri>（图标与许可 RTF），-d WebView2Setup=<WebView2 引导程序>）
//   4. signtool 签名 MSI（配置了证书时），写 SHA-256 校验文件
//   5. tauri signer sign 生成 updater 签名 .sig（配置了 TAURI_SIGNING_PRIVATE_KEY 时）
//
// 前提：pnpm build:core（dist/agent-core 与 dist/runtime）与 pnpm build:extensions（primus-bundle.js）已完成；
// 已安装 WiX 7 .NET 工具与 UI、Util 扩展（版本见 scripts/version-baseline.json，CI 中 `wix extension add -g`）。
// WiX 只能在 Windows 上运行；其他平台只能用 --dry-run 查看将要执行的命令。
//
// 用法：node scripts/build-msi.mjs [--version <SemVer>] [--skip-tauri] [--out-dir <目录>] [--webview2 <文件>] [--dry-run]
//   --version   默认取 apps/desktop/src-tauri/tauri.conf.json 的 version；与之不同时经
//               tauri build --config 同步给 Primus.exe，保证 exe、MSI 与文件名同一版本
//               （与 --skip-tauri 同用且版本不同则拒绝构建：已有的 exe 版本无法保证一致）
//   --skip-tauri 已编译好 Primus.exe 时跳过第 1 步；须是本脚本上次构建的产物：脚本在签名后把
//               exe 的版本、大小与修改时间写进旁边的 Primus.exe.build.json，跳过时逐项校验，
//               记录缺失、版本与 MSI 不同或 exe 已被其他方式重新生成都拒绝构建
//   --out-dir   MSI 输出目录，默认仓库根下 out/（已在 .gitignore 中）
//   --webview2  WebView2 Evergreen 引导程序（第 3.5 节），默认 apps/desktop/src-tauri/windows/webview2/
//               MicrosoftEdgeWebview2Setup.exe；不存在时从微软官方地址下载（不入库）。微软会更新该文件，
//               不固化哈希，改为校验 Authenticode 签名有效且签名者为 Microsoft Corporation
//
// 签名所需环境变量（证书与私钥只保存在 CI 密钥库，第 22.3 节）：
//   PRIMUS_SIGN_CERT_SHA1      代码签名证书指纹（signtool /sha1）
//   PRIMUS_SIGN_TIMESTAMP_URL  RFC 3161 时间戳服务器（signtool /tr）
//   PRIMUS_SIGNTOOL            signtool.exe 路径（默认取 PATH 中的 signtool）
//   TAURI_SIGNING_PRIVATE_KEY[/_PASSWORD]  updater 签名私钥（tauri signer 读取）
// 未配置时跳过对应签名并提示（开发与 PR 构建）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MANIFEST_FILE, verifyManifest } from "./core-dist.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const tauriDir = join(root, "apps/desktop/src-tauri");
export const WXS = join(tauriDir, "windows/Primus.wxs");
export const CULTURE = "zh-CN";
export const WIX_EXTENSIONS = ["WixToolset.UI.wixext", "WixToolset.Util.wixext"];
// 微软 WebView2 文档给出的 Evergreen 引导程序下载地址
export const WEBVIEW2_BOOTSTRAPPER_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
export const WEBVIEW2_BOOTSTRAPPER = join(
  tauriDir,
  "windows/webview2/MicrosoftEdgeWebview2Setup.exe",
);

/**
 * 预发布阶段在 MSI 第三字段中的偏移（第 3.3.3 节）。Windows Installer 只比较 ProductVersion 的前三个字段、
 * 忽略第四个，所以预发布到稳定版的先后必须体现在前三个字段里：第三字段 = 修订号 × 100 + 阶段偏移，
 * alpha.N → N、beta.N → 30 + N、rc.N → 60 + N（N ≤ 29），稳定版 → 99。
 * 例：1.3.0-alpha.1 → 1.3.1.0 < 1.3.0-beta.2 → 1.3.32.0 < 1.3.0-rc.1 → 1.3.61.0 < 1.3.0 → 1.3.99.0
 * < 1.3.1-alpha.0 → 1.3.100.0。稳定版严格高于同版本的所有预发布版，MajorUpgrade 可正常替换；
 * 反过来用预发布版覆盖同版本稳定版属于降级，仍被拒绝。
 */
export const MSI_PRERELEASE_STAGES = { alpha: 0, beta: 30, rc: 60 };
export const MSI_PRERELEASE_MAX = 29;
export const MSI_STABLE_OFFSET = 99;
export const MSI_PATCH_SCALE = 100;
// 第三字段上限 65535：修订号 ≤ 654（654 × 100 + 99 = 65499）
export const MSI_MAX_PATCH = Math.floor((65535 - MSI_STABLE_OFFSET) / MSI_PATCH_SCALE);

/**
 * SemVer → MSI ProductVersion（第 3.3.3 节）：主.次.(修订 × 100 + 阶段偏移).0。
 * 预发布标识只接受 alpha.N / beta.N / rc.N（N ≤ 29）；构建元数据（+…）不参与。
 * 主、次 ≤ 255，修订 ≤ 654（第三字段 ≤ 65535）。
 */
export function msiProductVersion(semver) {
  const m =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      semver,
    );
  if (!m) throw new Error(`版本号不是 SemVer：${semver}`);
  const [major, minor, patch] = [m[1], m[2], m[3]].map(Number);
  if (major > 255 || minor > 255) throw new Error(`MSI 版本的主、次版本不得超过 255：${semver}`);
  if (patch > MSI_MAX_PATCH)
    throw new Error(`MSI 版本的修订号不得超过 ${MSI_MAX_PATCH}（第三字段 ≤ 65535）：${semver}`);
  let offset = MSI_STABLE_OFFSET;
  if (m[4]) {
    const pre = /^(alpha|beta|rc)\.(0|[1-9]\d*)$/.exec(m[4]);
    if (!pre)
      throw new Error(
        `预发布标识须为 alpha.N、beta.N 或 rc.N，才能映射为有序的 MSI 版本：${semver}`,
      );
    const n = Number(pre[2]);
    if (n > MSI_PRERELEASE_MAX)
      throw new Error(`预发布序号不得超过 ${MSI_PRERELEASE_MAX}：${semver}`);
    offset = MSI_PRERELEASE_STAGES[pre[1]] + n;
  }
  return `${major}.${minor}.${patch * MSI_PATCH_SCALE + offset}.0`;
}

/** 按 Windows Installer 的规则比较两个 ProductVersion：只看前三个字段（负数 / 0 / 正数） */
export function compareMsiVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** 交付物文件名（第 3.1 节）：Primus_<ver>_x64_zh-CN.msi */
export function msiFileName(semver) {
  return `Primus_${semver}_x64_${CULTURE}.msi`;
}

/** wix build 参数（第 3.3.1 节第 3 步） */
export function wixBuildArgs({
  wxs = WXS,
  appDir,
  coreDir,
  runtimeDir,
  shellDir = tauriDir,
  webview2Setup = WEBVIEW2_BOOTSTRAPPER,
  productVersion,
  out,
}) {
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
    "-d",
    `ShellDir=${shellDir}`,
    "-d",
    `WebView2Setup=${webview2Setup}`,
    "-o",
    out,
  ];
}

/** 构建记录文件名（写在 Primus.exe 旁边，供 --skip-tauri 校验 exe 版本） */
export const EXE_STAMP = "Primus.exe.build.json";

/** 由 exe 的文件信息生成构建记录 */
export function exeStamp(version, stat) {
  return { version, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) };
}

/**
 * --skip-tauri 时校验已有 Primus.exe 是本脚本以 version 构建的产物（第 3.3.3 节：exe 与 MSI 同一版本）。
 * stamp 为上次写下的构建记录（缺失为 null），stat 为 exe 当前文件信息；一致返回 null，否则返回原因。
 */
export function checkExeStamp(stamp, version, stat) {
  if (!stamp)
    return `未找到构建记录 ${EXE_STAMP}，无法确认 Primus.exe 的版本，请去掉 --skip-tauri 重新编译`;
  if (stamp.version !== version)
    return `已有 Primus.exe 的版本为 ${stamp.version}，与 MSI 目标版本 ${version} 不一致，请去掉 --skip-tauri 重新编译`;
  const now = exeStamp(version, stat);
  if (stamp.size !== now.size || stamp.mtimeMs !== now.mtimeMs)
    return `Primus.exe 在上次构建后被其他方式重新生成（大小或修改时间与 ${EXE_STAMP} 不符），版本无法确认，请去掉 --skip-tauri 重新编译`;
  return null;
}

/** signtool 签名参数（第 3.3.1 节第 2、4 步）；未配置证书时返回 null */
export function signtoolArgs(file, env = process.env) {
  const sha1 = env.PRIMUS_SIGN_CERT_SHA1;
  const tsa = env.PRIMUS_SIGN_TIMESTAMP_URL;
  if (!sha1 || !tsa) return null;
  return ["sign", "/fd", "sha256", "/tr", tsa, "/td", "sha256", "/sha1", sha1, file];
}

/**
 * Authenticode 签名（Windows PowerShell 自带 Get-AuthenticodeSignature；路径经环境变量传入，免转义）。
 * 从 pwsh 7 启动时继承的 PSModulePath 指向 PowerShell 7 的模块，Windows PowerShell 5.1 会加载
 * Microsoft.PowerShell.Security 失败、取不到签名，所以去掉 PSModulePath 让它用自己的默认模块路径；
 * 命令出错一律以非零退出，避免把"读不到签名"误报成"签名不可信"。
 */
export function authenticodeEnv(env, file) {
  const out = Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toLowerCase() !== "psmodulepath"),
  );
  out.PRIMUS_VERIFY_FILE = file;
  return out;
}

function authenticode(file) {
  const r = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference = 'Stop'; " +
        "$s = Get-AuthenticodeSignature -LiteralPath $env:PRIMUS_VERIFY_FILE; " +
        "[pscustomobject]@{ Status = [string]$s.Status; Subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", env: authenticodeEnv(process.env, file) },
  );
  if (r.status !== 0) fail(`无法读取 ${file} 的签名：${r.stderr || r.error?.message}`);
  const signature = JSON.parse(r.stdout);
  if (!signature.Status) fail(`无法读取 ${file} 的签名：${r.stderr || r.stdout}`);
  return signature;
}

/** 微软签名有效的引导程序才能打进 MSI（它在安装时以 SYSTEM 身份运行） */
export function isTrustedMicrosoftSignature({ Status, Subject }) {
  return Status === "Valid" && /(^|,\s*)O="?Microsoft Corporation"?(,|$)/.test(Subject ?? "");
}

async function prepareWebView2(file, { download }) {
  if (!existsSync(file)) {
    if (!download) fail(`未找到 WebView2 引导程序：${file}`);
    console.log(`\n> 下载 WebView2 引导程序 ${WEBVIEW2_BOOTSTRAPPER_URL}`);
    const res = await fetch(WEBVIEW2_BOOTSTRAPPER_URL);
    if (!res.ok) fail(`下载 WebView2 引导程序失败：HTTP ${res.status}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const signature = authenticode(file);
  if (!isTrustedMicrosoftSignature(signature))
    fail(`WebView2 引导程序签名不可信：${signature.Status} ${signature.Subject}（${file}）`);
  const size = (readFileSync(file).length / 1024 / 1024).toFixed(1);
  console.log(`✓ WebView2 引导程序 ${size} MiB，微软签名有效（${signature.Subject}）`);
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      version: { type: "string" },
      "skip-tauri": { type: "boolean", default: false },
      "out-dir": { type: "string" },
      webview2: { type: "string" },
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
  const versionOverride = version !== tauriConf.version;
  if (versionOverride && args["skip-tauri"])
    fail(
      `--version ${version} 与 tauri.conf.json 的 ${tauriConf.version} 不同，不能与 --skip-tauri 同用（已构建的 Primus.exe 版本会与 MSI 不一致）`,
    );
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

  // WebView2 引导程序：缺失时下载，校验微软签名
  const webview2Setup = resolve(root, args.webview2 ?? WEBVIEW2_BOOTSTRAPPER);
  if (!dryRun) await prepareWebView2(webview2Setup, { download: !args.webview2 });

  // 1. 编译 Primus.exe（不打包）
  if (!args["skip-tauri"]) {
    const tauriArgs = ["--filter", "@primus/desktop", "tauri", "build", "--no-bundle"];
    if (versionOverride) {
      // 覆盖版本写进临时配置文件，经 --config 合并进 tauri.conf.json（避免在 shell 中转义 JSON）
      const confFile = join(
        dryRun ? tmpdir() : mkdtempSync(join(tmpdir(), "primus-msi-")),
        "tauri.version.json",
      );
      if (!dryRun) writeFileSync(confFile, `${JSON.stringify({ version })}\n`);
      tauriArgs.push("--config", quoted(confFile));
    }
    runPnpm([...tauriArgs, "--", "--locked"]);
  }
  const exe = join(appDir, "Primus.exe");
  const stampFile = join(appDir, EXE_STAMP);
  if (!dryRun && !existsSync(exe)) fail(`未找到 ${exe}`);
  if (args["skip-tauri"] && !dryRun) {
    const stamp = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, "utf8")) : null;
    const problem = checkExeStamp(stamp, version, statSync(exe));
    if (problem) fail(problem);
  }

  // 2. 签名 Primus.exe
  const signtool = process.env.PRIMUS_SIGNTOOL ?? "signtool";
  const signExe = signtoolArgs(exe);
  if (signExe) run(signtool, signExe);
  else
    console.log(
      "\n· 未配置 PRIMUS_SIGN_CERT_SHA1 / PRIMUS_SIGN_TIMESTAMP_URL，跳过 Primus.exe 签名",
    );
  // 签名会改写 exe，签名之后再记录（供下次 --skip-tauri 校验）
  if (!dryRun) writeFileSync(stampFile, `${JSON.stringify(exeStamp(version, statSync(exe)))}\n`);

  // 3. WiX 7 构建 MSI
  if (!dryRun) mkdirSync(outDir, { recursive: true });
  run(
    "wix",
    wixBuildArgs({ appDir, coreDir, runtimeDir, webview2Setup, productVersion, out: msi }),
  );

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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
