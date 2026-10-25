# scripts

| 脚本 | 作用 |
|---|---|
| `build-core.mjs` | `agent-core` 里 `npm ci`，下载并校验锁定的模型目录后离线构建（`build:offline`）；组装 `dist/agent-core/`（最小运行产物 + `manifest.json`），下载并校验 Node.js LTS 官方 zip、只解出 `node.exe` 与 `LICENSE` 到 `dist/runtime/`。参数：`--skip-install`、`--skip-build`、`--platform win-x64\|current` |
| `core-dist.mjs` | 上面两步共用的纯函数：SHA-256、`SHASUMS256.txt` 解析、最小 zip 读取与文件过滤、manifest 生成与校验（单测 `core-dist.test.ts`） |
| `node-runtime.json` | 内置 Node.js 运行时的锁定版本与固化哈希（发行包与解出文件） |
| `smoke-core-rpc.mjs` | 启动 `rpc-entry.js`（临时 HOME、离线），发送 `get_state`，校验收到成功 `response`；`--dist` 跑组装好的 `dist/agent-core`（先按 manifest 校验，复制到含中文与空格的临时安装目录，Windows 上用 `dist/runtime/node.exe`），`--entry` / `--node` 可指定入口与运行时 |
| `check-forbidden-sdk.mjs` | 检查导入图与 SBOM，出现被禁供应商 SDK 即失败（C1） |
| `check-tauri-imports.mjs` | 只允许 `src/lib/platform/tauri/` import `@tauri-apps/*` |
| `check-naming.mjs` | `agent-core/` 之外不得出现上游项目原始名称（第 1.3 节） |
| `check-versions.mjs` | 工具链（含 `node-runtime.json`）与依赖版本与 `version-baseline.json`（技术方案第 2.4 节）一致，且全部精确锁定、无预发布版 |
| `version-baseline.json` | 版本基线（含 CI 安装的 cargo-nextest、tauri-driver 版本，`check-versions.mjs` 校验 ci.yml 与之一致）；Renovate 月度 PR 会同步更新它 |
| `build-msi.ps1` | `tauri build --no-bundle` → 签名 → `wix build` → 签名 MSI → `tauri signer` 生成 `.sig` |
