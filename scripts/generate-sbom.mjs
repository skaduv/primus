#!/usr/bin/env node
// 生成 CycloneDX SBOM（技术方案第 6.2 节第 2 条、第 22.1 节第 3 步），供被禁 SDK 检查与发布归档：
//
//   dist/sbom/primus-workspace.cdx.json   pnpm 工作区全部依赖（pnpm 自带 `pnpm sbom`，按 pnpm-lock.yaml，含开发依赖）
//   dist/sbom/agent-core.cdx.json         agent-core/ 的 npm 依赖（npm 自带 `npm sbom`，按 package-lock.json）
//
// 只读锁文件（--lockfile-only / --package-lock-only），不需要先安装依赖，结果可复现；两者都用包管理器
// 自带的命令，不引入额外依赖。开发依赖也列入：构建工具若引入被禁 SDK 同样不允许。
// pnpm 默认取 PATH 中的 pnpm，可用环境变量 PRIMUS_PNPM 指定（如 "npx -y pnpm@12.15.0"）。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "dist/sbom");
const shell = process.platform === "win32";

function capture(command, args, cwd) {
  console.log(`> ${[command, ...args].join(" ")}${cwd === root ? "" : `（${cwd}）`}`);
  const r = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    shell,
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.error?.message);
    console.error(`✗ 命令失败（退出码 ${r.status}）：${[command, ...args].join(" ")}`);
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

function write(name, json) {
  const bom = JSON.parse(json);
  if (bom.bomFormat !== "CycloneDX") throw new Error(`${name} 不是 CycloneDX 格式`);
  writeFileSync(join(outDir, name), `${JSON.stringify(bom, null, 2)}\n`);
  console.log(
    `✓ dist/sbom/${name}：${bom.components?.length ?? 0} 个组件（CycloneDX ${bom.specVersion}）`,
  );
}

mkdirSync(outDir, { recursive: true });

const [pnpm, ...pnpmPrefix] = (process.env.PRIMUS_PNPM ?? "pnpm").split(" ").filter(Boolean);
write(
  "primus-workspace.cdx.json",
  capture(
    pnpm,
    [
      ...pnpmPrefix,
      "sbom",
      "--sbom-format",
      "cyclonedx",
      "--sbom-type",
      "application",
      "--lockfile-only",
      "--recursive",
    ],
    root,
  ),
);

const coreDir = join(root, "agent-core");
if (existsSync(join(coreDir, "package-lock.json"))) {
  const lock = JSON.parse(readFileSync(join(coreDir, "package-lock.json"), "utf8"));
  if (!lock.lockfileVersion) throw new Error("agent-core/package-lock.json 格式不正确");
  write(
    "agent-core.cdx.json",
    capture(
      "npm",
      ["sbom", "--sbom-format", "cyclonedx", "--sbom-type", "application", "--package-lock-only"],
      coreDir,
    ),
  );
}
