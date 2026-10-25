# windows

- `Primus.wxs`：WiX 7 安装包定义（第 3.3 节）。`UpgradeCode` 固定为 `5B4199DD-C352-459A-AEB0-7119A884608F`，**永不改变**（MajorUpgrade 靠它识别旧版本）；`data` 目录组件的 GUID 同样固定。
- `webview2/`：WebView2 Evergreen 引导程序 `MicrosoftEdgeWebview2Setup.exe`（约 1.8MB）。不入库：`build-msi.mjs` 缺失时从微软官方地址下载，校验 Authenticode 签名有效且签名者为 Microsoft Corporation 后作为 `Binary` 打进 MSI；安装时注册表中查不到按机器安装的 WebView2（HKLM 32 位视图的 `pv` 为空或 `0.0.0.0`；MSI 面向所有用户，安装者 HKCU 下的按用户运行时不算）才以 SYSTEM 身份静默运行，失败则回滚安装。
- `License.rtf`：安装界面许可页（`WixUILicenseRtf`），中文以 RTF `\uN\'3f` 转义（Unicode 码点 + `?` 回退字符的十六进制形式，各解析器一致）；改文案时保持 RTF 有效（可用写字板打开另存）。
- `nsis/`：备选 NSIS 安装脚本（第 3.4 节）。

构建：仓库根运行 `pnpm build:msi`（`scripts/build-msi.mjs`：`tauri build --no-bundle` → 签名 → `wix build` → 签名 MSI → SHA-256 → `tauri signer`，输出 `out/Primus_<ver>_x64_zh-CN.msi`）。等价的 WiX 命令（在仓库根执行；`CARGO_TARGET_DIR` 未设置时）：`wix build apps/desktop/src-tauri/windows/Primus.wxs -arch x64 -culture zh-CN -acceptEula wix7 -ext WixToolset.UI.wixext -ext WixToolset.Util.wixext -bindpath app=apps/desktop/src-tauri/target/release -bindpath core=dist/agent-core -bindpath runtime=dist/runtime -d ProductVersion=<主.次.(修订×100+阶段).0，见第 3.3.3 节> -d ShellDir=apps/desktop/src-tauri -d WebView2Setup=<引导程序路径> -o out/Primus_<ver>_x64_zh-CN.msi`

`core`、`runtime` 两个目录由仓库根的 `pnpm build:core` 生成（目录结构见根 README「Core 产物与内置运行时」）：`dist/agent-core/` 整目录收进 `resources\agent-core\`（`manifest.json` 列出每个文件的 SHA-256），`dist/runtime/` 只有官方 `node.exe` 与 `LICENSE`，收进 `resources\runtime\`。打 MSI 前先运行 `pnpm build:extensions`，把 `primus-bundle.js` 写入 `dist/agent-core/extensions/`。`node.exe` 保留 OpenJS 官方签名，不重签。

## 安装包要点（第 3.3.2 节）

| 内容 | 做法 |
|---|---|
| 安装目录可选 | `WixUI_InstallDir`，默认 `C:\Program Files\Primus`；静默安装可传 `INSTALLFOLDER="D:\某目录"` |
| 主程序与资源 | `Primus.exe` 在安装目录根；`resources\runtime`、`resources\agent-core` 用 `<Files>` 整目录收集 |
| `data` 目录 | `CreateFolder` + `util:PermissionEx` 给本地化的 Users 组（`util:QueryWindowsWellKnownSIDs` 查出的 `[WIX_ACCOUNT_USERS]`）授予“修改”(M)，继承到子项；组件 `Permanent`，卸载与升级保留 |
| 升级 | `MajorUpgrade` + 固定 `UpgradeCode`；降级给出中文提示 |
| WebView2 | 注册表检测，缺失时运行内嵌引导程序 |
| 快捷方式 | 公共开始菜单“乾元 Primus”，`System.AppUserModel.ID = com.primus.desktop`（通知归属） |
| 卸载信息 | `ARPPRODUCTICON`、`ARPURLINFOABOUT`；`ARPNOMODIFY`（安装目录装后不可改，修复 / 卸载可用） |

CI（`.github/workflows/ci.yml` Windows 作业）构建 MSI 后用 `scripts/msi-smoke.ps1` 静默安装，检查布局、`data` 的 ACL（`BUILTIN\Users` 显式 Modify 且继承，显式与继承的 Users 授权都没有更改权限 / 取得所有权）、以中完整性级别（去掉管理员权限）实际写入 `data` 且写不进安装目录根、开始菜单快捷方式与 WebView2 处理，再卸载并确认 `data` 与其中文件仍在。
