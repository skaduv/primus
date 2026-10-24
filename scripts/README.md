# scripts

| 脚本 | 作用 |
|---|---|
| `build-core.mjs` | `cd agent-core && npm ci && npm run build`，复制产物到 `dist/agent-core/`；下载并校验 Node.js LTS `node.exe` 到 `dist/runtime/` |
| `check-forbidden-sdk.mjs` | 检查导入图与 SBOM，出现被禁供应商 SDK 即失败（C1） |
| `check-tauri-imports.mjs` | 只允许 `src/lib/platform/tauri/` import `@tauri-apps/*` |
| `check-naming.mjs` | `agent-core/` 之外不得出现上游项目原始名称（第 1.3 节） |
| `build-msi.ps1` | `tauri build --no-bundle` → 签名 → `wix build` → 签名 MSI → `tauri signer` 生成 `.sig` |
