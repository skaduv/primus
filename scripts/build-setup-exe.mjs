#!/usr/bin/env node
// 构建 exe 安装程序 PrimusSetup_<ver>_<arch>_zh-CN.exe（ADR 0011）：把已构建好的同架构 MSI 装进一个
// WiX 7 Burn 引导程序（apps/desktop/src-tauri/windows/Bundle.wxs）。x64 与 ARM64 各一个 exe，下错架构时 exe 用中文提示。
// exe 不经 .msi 文件关联直接调用 Windows Installer，给 .msi 关联被改坏、双击 MSI 打不开的电脑用；
// 装好的仍是 MSI 本身，自动更新清单与应用内更新照旧只认 MSI（update-feed 不变）。
//
//   wix build Bundle.wxs -arch x86 -acceptEula wix7 -ext WixToolset.BootstrapperApplications.wixext
//     -d ProductVersion=<与 MSI 相同> -d ShellDir=<src-tauri> -d Arch=<x64|arm64> -d Msi=<msi> -o <exe>
//
// 前提：MSI 已由 scripts/build-msi.mjs 构建；已安装 WiX 7 .NET 工具与 BootstrapperApplications 扩展
// （版本见 scripts/version-baseline.json，CI 中 `wix extension add -g`）。WiX 只能在 Windows 上运行；
// 其他平台只能用 --dry-run 查看将要执行的命令。不做 Authenticode 签名（与 MSI 相同，ADR 0007）。
//
// 用法：node scripts/build-setup-exe.mjs --arch <x64|arm64> --msi <msi> [--version <SemVer>] [--out-dir <目录>] [--dry-run]
//   --arch      目标架构，默认 x64
//   --msi       同架构的 MSI，文件名须为 Primus_<ver>_<arch>_zh-CN.msi；默认取输出目录下的同名文件
//   --version   默认取 apps/desktop/src-tauri/tauri.conf.json 的 version（发布工作流显式传标签版本）
//   --out-dir   输出目录，默认仓库根下 out/；同时写 <exe>.sha256
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CULTURE, msiFileName, msiProductVersion } from "./build-msi.mjs";

export const ARCHES = ["x64", "arm64"];

const root = fileURLToPath(new URL("..", import.meta.url));
const tauriDir = join(root, "apps/desktop/src-tauri");

export const BUNDLE_WXS = join(tauriDir, "windows/Bundle.wxs");
export const BUNDLE_WXL = join(tauriDir, "windows/bundle-zh-CN.wxl");
export const BUNDLE_EXTENSION = "WixToolset.BootstrapperApplications.wixext";
/**
 * Burn 引擎架构：两个 exe 都用 x86 引擎，x64 与 ARM64（x86 仿真）上都能运行，
 * 下错架构时由 Bundle.wxs 的 bal:Condition 给出中文说明
 */
export const BUNDLE_ARCH = "x86";

function checkArch(arch) {
  if (!ARCHES.includes(arch)) throw new Error(`架构只能是 ${ARCHES.join(" 或 ")}，实际为 ${arch}`);
}

/** exe 安装程序文件名（与旧 NSIS 版的 Primus_<ver>_<arch>-setup.exe 区分开） */
export function setupExeFileName(semver, arch) {
  checkArch(arch);
  msiProductVersion(semver); // 只校验版本号可映射为 MSI 版本
  return `PrimusSetup_${semver}_${arch}_${CULTURE}.exe`;
}

/** wix build 参数 */
export function wixBundleArgs({
  wxs = BUNDLE_WXS,
  shellDir = tauriDir,
  productVersion,
  arch,
  msi,
  out,
}) {
  if (!productVersion || !msi || !out) throw new Error("缺少 productVersion、msi 或 out");
  checkArch(arch);
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
    `Arch=${arch}`,
    "-d",
    `Msi=${msi}`,
    "-o",
    out,
  ];
}

/**
 * 校验传入的 MSI：文件名须与版本、架构一致（Primus_<ver>_<arch>_zh-CN.msi）。
 * 一致返回 null，否则返回原因。exists 便于测试替换。
 */
export function checkMsiInput(file, version, arch, exists = existsSync) {
  if (!file) return "缺少 --msi <MSI>";
  const want = msiFileName(version, arch);
  if (basename(file) !== want) return `--msi 的文件名应为 ${want}，实际为 ${basename(file)}`;
  if (!exists(file)) return `未找到 ${file}`;
  return null;
}

function main() {
  const { values: args } = parseArgs({
    options: {
      arch: { type: "string", default: "x64" },
      msi: { type: "string" },
      version: { type: "string" },
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

  const arch = args.arch;
  if (!ARCHES.includes(arch)) fail(`--arch 只能是 ${ARCHES.join(" 或 ")}，实际为 ${arch}`);
  const outDir = resolve(args["out-dir"] ?? join(root, "out"));
  const exists = dryRun ? () => true : existsSync;
  const msi = resolve(args.msi ?? join(outDir, msiFileName(version, arch)));
  const msiProblem = checkMsiInput(msi, version, arch, exists);
  if (msiProblem) fail(msiProblem);

  const exe = join(outDir, setupExeFileName(version, arch));
  const wixArgs = wixBundleArgs({ productVersion, arch, msi, out: exe });

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
    console.log(`\n✓ exe 安装程序：${exe}\n  SHA-256：${digest}`);
  } else {
    console.log(`\n✓ （演练）exe 安装程序：${exe}`);
  }
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
