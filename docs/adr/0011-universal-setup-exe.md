# 0011 通用安装程序 PrimusSetup.exe（WiX Burn）

- 状态：已接受
- 日期：2026-11-14

## 背景

ADR 0007 起只发 MSI。实际分发中，有些 Windows 10 电脑双击 `.msi` 时提示“Windows 无法识别此类型的文件”或直接打不开：`.msi` 的文件关联被其他软件改坏，安装包本身没有问题（SHA-256 与 Release 正文一致，摘要信息为 `x64;2052`、Windows Installer 5.0）。用户还要自己分辨 x64 与 ARM64 两个文件，下错架构同样装不上。

需要一个双击就能装的 `.exe`，但不能重新引入 NSIS：两种安装方式并存会让自动更新、迁移与测试矩阵翻倍，这正是 ADR 0007 停发 NSIS 的原因。

## 决策

- 发布时另出一个通用安装程序 `PrimusSetup_<ver>_zh-CN.exe`，用 WiX 7 Burn 构建（`apps/desktop/src-tauri/windows/Bundle.wxs`，脚本 `scripts/build-setup-exe.mjs`），与两个 MSI 一起上传到源码仓与公开仓的 Release。
- Burn 引擎为 x86，x64 与 ARM64（x86 仿真）都能运行。内嵌两个 MSI，按 Burn 变量 `NativeMachine` 只装一个（43620 = `0xAA64` 为 ARM64，其余为 x64；Windows 10 1709 之前没有该变量，也没有 ARM64）。32 位 Windows 由 `bal:Condition VersionNT64` 拦下并给出中文说明。
- Burn 直接调用 Windows Installer API 安装 MSI，不经 `.msi` 文件关联。
- 安装界面就是 MSI 自己的界面（`bal:DisplayInternalUICondition="WixBundleAction = 6"`）：隐私政策、选择安装目录（约束 C2）与直接装 MSI 一致。引导程序自身只有一页“安装”和进度、结果页，文案为自带的中文 `bundle-zh-CN.wxl`（WiX 只自带英文）。
- 两个 `MsiPackage` 都设为 `Permanent="yes"`、`Visible="yes"`、`Cache="remove"`：Burn 只在有可卸载的包时登记 bundle，所以 exe 不在“应用和功能”中留下自己的条目，也不在 Package Cache 中保留副本；装好的就是 MSI 本身。`DisableModify` / `DisableRemove` 兜底，重启待定等情况下即使留下登记也不显示。这样应用内自动更新（只认 `windows-<arch>-msi`）、`PrimusUpdate` 服务、卸载与 NSIS 迁移全部沿用 ADR 0007，`update-feed` 不变。
- MSI 完成页的“立即启动”用 `WixShellExec` 在界面进程中启动 Primus；经 Burn 安装时界面进程是提权进程，会让 Primus 以管理员身份运行。为此 bundle 给 MSI 传 `PRIMUS_BUNDLE=1`，`Primus.wxs` 此时不显示该勾选框；用户从开始菜单或桌面打开。
- `Bundle.wxs` 的 `UpgradeCode` 固定为 `FD216D87-9A80-4208-A28D-FA4B80241F96`，与 MSI 的不同，永不改变。
- 发布工作流：矩阵构建两个 MSI 后，`setup-exe` 作业（取工作流自身提交中的 `Bundle.wxs` 与脚本）构建 exe，`setup-exe-smoke` 在 x64 与 ARM64 运行器上各做一次静默安装 / 卸载冒烟（`scripts/setup-exe-smoke.ps1`：只有 MSI 的卸载条目、没有 bundle 登记、版本记录正确、`Primus.exe` 架构与本机一致），全部通过后才发布。CI 的 x64 作业用只含 x64 MSI 的 exe（`--allow-missing-arm64`，不能发布）做同样的冒烟。
- 与 MSI 一样不做 Authenticode 签名，首次运行同样有 SmartScreen 提示。

## 后果

- 双击 MSI 打不开的电脑可以改用 exe；不必再区分 x64 与 ARM64。
- exe 约为两个 MSI 之和（约 100MB），Release 多一个附件；发布多两个冒烟作业。
- 回填早于本 ADR 的版本时没有 exe，`publish-release.sh` 只在目录里有 exe 时才上传（发布工作流设 `REQUIRE_SETUP_EXE=1` 强制要求）。
- 用早于本 ADR 的标签重建时，exe 会用工作流提交中的 `Bundle.wxs` 打包旧 MSI；旧 MSI 不认识 `PRIMUS_BUNDLE`，其完成页仍会显示“立即启动”。只影响手动重建旧标签。
- 经 exe 安装没有“立即启动”，这是为不以管理员身份运行 Primus 所做的取舍。
