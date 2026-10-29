// 选择要运行的 Agent Core 入口与运行时：RPC 冒烟（smoke-core-rpc.mjs）与 RPC 契约测试（contract-core-rpc.mjs）共用。
//
//   默认                     agent-core 构建目录里的 rpc-entry.js（当前 node）
//   dist: true               组装好的 dist/agent-core（第 3.2 节安装布局）
//   entry / node             指定入口与运行时；环境变量 PRIMUS_SMOKE_ENTRY / PRIMUS_SMOKE_NODE 等价（参数优先）。
//                            dist 与 entry（含 PRIMUS_SMOKE_ENTRY）互斥，同时指定时报错；dist 可另指 node
//
// dist 时先按 manifest.json 校验产物，再把 dist/agent-core 与 dist/runtime 复制到 sandbox 下一个
// 含中文与空格的「安装目录」\resources\ 中运行：既模拟安装后的目录结构，也避免模块解析向上
// 找到仓库里的 node_modules 而掩盖缺文件。运行时：Windows 上用 dist/runtime/node.exe，
// 其他平台（node.exe 无法运行）或未下载运行时（--platform current）时用当前 node。
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_FILE, verifyManifest } from "./core-dist.mjs";

export const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export class CoreTargetError extends Error {}

/**
 * @param {{ dist?: boolean, entry?: string, node?: string, sandbox: string }} options
 * @returns {{ entry: string, nodeExe: string, note?: string }}
 */
export function prepareCoreTarget({ dist = false, entry, node, sandbox }) {
  // 显式传入的空字符串是调用方的错误，不能当作「未指定」静默改用默认值；空的环境变量视同未设置
  if (entry === "") throw new CoreTargetError("✗ --entry 不能为空");
  if (node === "") throw new CoreTargetError("✗ --node 不能为空");
  let entryPath = entry ?? (process.env.PRIMUS_SMOKE_ENTRY || undefined);
  let nodeExe = node ?? (process.env.PRIMUS_SMOKE_NODE || undefined);
  let note;

  if (dist) {
    // dist 的入口固定为复制后的 dist/agent-core/rpc-entry.js，不能再另指入口，以免静默忽略
    if (entryPath !== undefined)
      throw new CoreTargetError(
        `✗ dist 模式不能同时指定入口（${entry !== undefined ? "--entry" : "PRIMUS_SMOKE_ENTRY"}=${entryPath}）：dist 固定运行 dist/agent-core/rpc-entry.js`,
      );
    const distCore = join(repoRoot, "dist/agent-core");
    const manifestPath = join(distCore, MANIFEST_FILE);
    if (!existsSync(manifestPath))
      throw new CoreTargetError(`✗ 未找到 ${manifestPath}，请先运行 pnpm build:core`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const problems = verifyManifest(distCore, manifest, { skip: ["extensions"] });
    if (problems.length)
      throw new CoreTargetError(`✗ dist/agent-core 与 manifest 不符：\n  ${problems.join("\n  ")}`);

    const resources = join(sandbox, "安装 目录", "resources");
    cpSync(distCore, join(resources, "agent-core"), { recursive: true });
    entryPath = join(resources, "agent-core", "rpc-entry.js");

    const runtimeExe = join(repoRoot, "dist/runtime/node.exe");
    if (!nodeExe && process.platform === "win32" && existsSync(runtimeExe)) {
      cpSync(join(repoRoot, "dist/runtime"), join(resources, "runtime"), { recursive: true });
      nodeExe = join(resources, "runtime", "node.exe");
    }
    note = `manifest 校验通过（${manifest.files.length} 个文件），运行时 ${nodeExe ? "dist/runtime/node.exe" : `当前 node ${process.version}`}`;
  }

  entryPath = resolve(
    entryPath ?? join(repoRoot, "agent-core/packages/coding-agent/dist/bundle/rpc-entry.js"),
  );
  nodeExe = nodeExe ? resolve(nodeExe) : process.execPath;
  if (!existsSync(entryPath))
    throw new CoreTargetError(`✗ 未找到 ${entryPath}，请先运行 pnpm build:core`);
  if (!existsSync(nodeExe)) throw new CoreTargetError(`✗ 未找到运行时 ${nodeExe}`);
  return { entry: entryPath, nodeExe, note };
}

/**
 * 薄壳启动 Core 时的环境变量（技术方案第 4.4 节）：配置与会话目录指向 coreDir，HOME / USERPROFILE 指向 home
 * （若 Core 忽略 PRIMUS_CODING_AGENT_DIR 回退到主目录，会在 home/.primus 下留下痕迹），清空 NODE_OPTIONS。
 */
export function coreEnv({ home, coreDir }) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PRIMUS_CODING_AGENT_DIR: coreDir,
    PRIMUS_CODING_AGENT_SESSION_DIR: join(coreDir, "sessions"),
    PRIMUS_SKIP_VERSION_CHECK: "1",
    PRIMUS_TELEMETRY: "0",
    NODE_OPTIONS: "",
  };
}
