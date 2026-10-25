# windows

- `Primus.wxs`：WiX 7 安装包定义（第 3.3 节）。`UpgradeCode` 固定为 `5B4199DD-C352-459A-AEB0-7119A884608F`，**永不改变**（MajorUpgrade 靠它识别旧版本）；`data` 目录组件的 GUID 同样固定。
- `webview2/`：WebView2 引导程序（约 1.8MB，缺失或版本过低时运行）。
- `nsis/`：备选 NSIS 安装脚本（第 3.4 节）。

构建：仓库根运行 `pnpm build:msi`（`scripts/build-msi.mjs`：`tauri build --no-bundle` → 签名 → `wix build` → 签名 MSI → SHA-256 → `tauri signer`，输出 `out/Primus_<ver>_x64_zh-CN.msi`）。等价的 WiX 命令（在仓库根执行；`CARGO_TARGET_DIR` 未设置时）：`wix build apps/desktop/src-tauri/windows/Primus.wxs -arch x64 -culture zh-CN -acceptEula wix7 -ext WixToolset.UI.wixext -ext WixToolset.Util.wixext -bindpath app=apps/desktop/src-tauri/target/release -bindpath core=dist/agent-core -bindpath runtime=dist/runtime -d ProductVersion=<x.y.z.0> -o out/Primus_<ver>_x64_zh-CN.msi`

`core`、`runtime` 两个目录由仓库根的 `pnpm build:core` 生成（目录结构见根 README「Core 产物与内置运行时」）：`dist/agent-core/` 整目录收进 `resources\agent-core\`（`manifest.json` 列出每个文件的 SHA-256），`dist/runtime/` 只有官方 `node.exe` 与 `LICENSE`，收进 `resources\runtime\`。打 MSI 前先运行 `pnpm build:extensions`，把 `primus-bundle.js` 写入 `dist/agent-core/extensions/`。`node.exe` 保留 OpenJS 官方签名，不重签。
