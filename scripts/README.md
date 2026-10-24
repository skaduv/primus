# scripts

| 脚本 | 作用 |
|---|---|
| `build-core.mjs` | `cd agent-core && npm ci && npm run build`，复制产物到 `dist/agent-core/`；下载并校验 Node.js LTS `node.exe` 到 `dist/runtime/` |
| `check-forbidden-sdk.mjs` | 检查导入图与 SBOM，出现被禁供应商 SDK 即失败（C1） |
| `check-tauri-imports.mjs` | 只允许 `src/lib/platform/tauri/` import `@tauri-apps/*` |
| `check-naming.mjs` | `agent-core/` 之外不得出现上游项目原始名称（第 1.3 节） |
| `check-versions.mjs` | 工具链与依赖版本与 `version-baseline.json`（技术方案第 2.4 节）一致，且全部精确锁定、无预发布版 |
| `version-baseline.json` | 版本基线；Renovate 月度 PR 会同步更新它 |
| `build-msi.ps1` | `tauri build --no-bundle` → 签名 → `wix build` → 签名 MSI → `tauri signer` 生成 `.sig` |
