#!/usr/bin/env node
// 构建通用安装程序 PrimusSetup_<ver>_zh-CN.exe（ADR 0011）：把已构建好的 x64 与 ARM64 两个 MSI 装进一个
// WiX 7 Burn 引导程序（apps/desktop/src-tauri/windows/Bundle.wxs），安装时按本机原生架构只装其中一个。
// exe 不经 .msi 文件关联直接调用 Windows Installer，给 .msi 关联被改坏、双击 MSI 打不开的电脑用；
// 装好的仍是 MSI 本身，自动更新清单与应用内更新照旧只认 MSI（update-feed 不变）。
//
//   wix build Bundle.wxs -arch x86 -acceptEula wix7 -ext WixToolset.BootstrapperApplications.wixext
//     -d ProductVersion=<与 MSI 相同> -d ShellDir=<src-tauri> -d X64Msi=<msi> [-d Arm64Msi=<msi>] -o <exe>
//
// 前提：两个 MSI 已由 scripts/build-msi.mjs 构建；已安装 WiX 7 .NET 工具与 BootstrapperApplications 扩展
// （版本见 scripts/version-baseline.json，CI 中 `wix extension add -g`）。WiX 只能在 Windows 上运行；
// 其他平台只能用 --dry-run 查看将要执行的命令。不做 Authenticode 签名（与 MSI 相同，ADR 0007）。
//
// 用法：node scripts/build-setup-exe.mjs --x64 <msi> --arm64 <msi> [--version <SemVer>] [--out-dir <目录>] [--dry-run]
//   --x64 / --arm64  两个 MSI，文件名须为 Primus_<ver>_<x64|arm64>_zh-CN.msi
//   --version        默认取 apps/desktop/src-tauri/tauri.conf.json 的 version（发布工作流显式传标签版本）
//   --allow-missing-arm64  只打进 x64 MSI（CI 的 x64 作业只构建了 x64 MSI，用来验证 exe 能构建、能安装）；
//                    这样的 exe 在 ARM64 上什么也不装，不能发布
//   --out-dir        输出目录，默认仓库根下 out/；同时写 <exe>.sha256
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CULTURE, msiFileName, msiProductVersion } from "./build-msi.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const tauriDir = join(root, "apps/desktop/src-tauri");

export const BUNDLE_WXS = join(tauriDir, "windows/Bundle.wxs");
export const BUNDLE_WXL = join(tauriDir, "windows/bundle-zh-CN.wxl");
export const BUNDLE_EXTENSION = "WixToolset.BootstrapperApplications.wixext";
/** Burn 引擎架构：x86 引擎在 x64 与 ARM64（x86 仿真）上都能运行，一个 exe 通用 */
export const BUNDLE_ARCH = "x86";

/** 通用安装程序文件名（与旧 NSIS 版的 Primus_<ver>_<arch>-setup.exe 区分开） */
export function setupExeFileName(semver) {
  msiProductVersion(semver); // 只校验版本号可映射为 MSI 版本
  return `PrimusSetup_${semver}_${CULTURE}.exe`;
}

/** wix build 参数；arm64Msi 为空时 Bundle.wxs 不收 ARM64 包（仅 CI 用） */
export function wixBundleArgs({
  wxs = BUNDLE_WXS,
  shellDir = tauriDir,
  productVersion,
  x64Msi,
  arm64Msi,
  out,
}) {
  if (!productVersion || !x64Msi || !out) throw new Error("缺少 productVersion、x64Msi 或 out");
  return [
    "build",
    wxs,
    "-arch",
    BUNDLE_ARCH,
    "-acceptEula",
    "wix7",
    "-ext",
    BUNDLE_EXTENSION,
    "-d",
    `ProductVersion=${productVersion}`,
    "-d",
    `ShellDir=${shellDir}`,
    "-d",
    `X64Msi=${x64Msi}`,
    ...(arm64Msi ? ["-d", `Arm64Msi=${arm64Msi}`] : []),
    "-o",
    out,
  ];
}

/**
 * 校验传入的 MSI：文件名须与版本、架构一致（Primus_<ver>_<arch>_zh-CN.msi）。
 * 一致返回 null，否则返回原因。exists 便于测试替换。
 */
export function checkMsiInput(file, version, arch, exists = existsSync) {
  if (!file) return `缺少 --${arch} <MSI>`;
  const want = msiFileName(version, arch);
  if (basename(file) !== want) return `--${arch} 的文件名应为 ${want}，实际为 ${basename(file)}`;
  if (!exists(file)) return `未找到 ${file}`;
  return null;
}

function main() {
  const { values: args } = parseArgs({
    options: {
      x64: { type: "string" },
      arm64: { type: "string" },
      version: { type: "string" },
      "allow-missing-arm64": { type: "boolean", default: false },
      "out-dir": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const dryRun = args["dry-run"];
  if (process.platform !== "win32" && !dryRun)
    fail("WiX 只能在 Windows 上运行；在其他平台可用 --dry-run 查看命令");

  const tauriConf = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8"));
  const version = args.version ?? tauriConf.version;
  let productVersion;
  try {
    productVersion = msiProductVersion(version);
  } catch (e) {
    fail(e.message);
  }

  const exists = dryRun ? () => true : existsSync;
  const x64Msi = args.x64 && resolve(args.x64);
  const arm64Msi = args.arm64 && resolve(args.arm64);
  const x64Problem = checkMsiInput(x64Msi, version, "x64", exists);
  if (x64Problem) fail(x64Problem);
  if (arm64Msi || !args["allow-missing-arm64"]) {
    const arm64Problem = checkMsiInput(arm64Msi, version, "arm64", exists);
    if (arm64Problem) fail(arm64Problem);
  } else {
    console.log("! 未传 --arm64：生成的 exe 只含 x64 MSI，只能用于 CI 验证，不能发布");
  }

  const outDir = resolve(args["out-dir"] ?? join(root, "out"));
  const exe = join(outDir, setupExeFileName(version));
  const wixArgs = wixBundleArgs({ productVersion, x64Msi, arm64Msi, out: exe });

  const run = (command, commandArgs, { capture = false } = {}) => {
    console.log(`\n> ${[command, ...commandArgs].join(" ")}`);
    if (dryRun) return "";
    const r = spawnSync(command, commandArgs, {
      cwd: root,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      encoding: "utf8",
    });
    if (r.error) fail(`无法启动 ${command}：${r.error.message}`);
    if (r.status !== 0) fail(`命令失败（退出码 ${r.status}）：${command} ${commandArgs.join(" ")}`);
    return capture ? r.stdout : "";
  };

  if (!dryRun) {
    const baseline = JSON.parse(readFileSync(join(root, "scripts/version-baseline.json"), "utf8"));
    const wixVersion = run("wix", ["--version"], { capture: true }).trim();
    if (!wixVersion.startsWith(`${baseline.toolchain.wix}`))
      fail(`WiX 版本为 ${wixVersion}，基线为 ${baseline.toolchain.wix}（技术方案第 2.4 节）`);
    mkdirSync(outDir, { recursive: true });
  }

  run("wix", wixArgs);

  if (!dryRun) {
    if (!existsSync(exe)) fail(`wix build 没有生成 ${exe}`);
    const digest = createHash("sha256").update(readFileSync(exe)).digest("hex");
    writeFileSync(`${exe}.sha256`, `${digest}  ${basename(exe)}\n`);
    console.log(`\n✓ 通用安装程序：${exe}\n  SHA-256：${digest}`);
  } else {
    console.log(`\n✓ （演练）通用安装程序：${exe}`);
  }
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
