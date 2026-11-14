# 0011 exe 安装程序 PrimusSetup（WiX Burn，x64 / ARM64 各一个）

- 状态：已接受
- 日期：2026-11-14

## 背景

ADR 0007 起只发 MSI。实际分发中，有些 Windows 10 电脑双击 `.msi` 时提示“Windows 无法识别此类型的文件”或直接打不开：`.msi` 的文件关联被其他软件改坏，安装包本身没有问题（SHA-256 与 Release 正文一致，摘要信息为 `x64;2052`、Windows Installer 5.0）。

需要一个双击就能装的 `.exe`，但不能重新引入 NSIS：两种安装方式并存会让自动更新、迁移与测试矩阵翻倍，这正是 ADR 0007 停发 NSIS 的原因。

## 决策

- 发布时每个架构另出一个 exe 安装程序 `PrimusSetup_<ver>_<x64|arm64>_zh-CN.exe`，用 WiX 7 Burn 构建（`apps/desktop/src-tauri/windows/Bundle.wxs`，脚本 `scripts/build-setup-exe.mjs --arch <arch>`），各内嵌同架构的一个 MSI，与两个 MSI 一起上传到源码仓与公开仓的 Release。
  - 不做一个内嵌两个 MSI 的通用 exe：那样体积约为两个 MSI 之和（约 100MB），而每台电脑只用得到其中一半；分架构与 MSI 的分发方式一致。
- Burn 直接调用 Windows Installer API 安装 MSI，不经 `.msi` 文件关联。
- 两个 exe 的 Burn 引擎都是 x86：x64 与 ARM64（经 x86 仿真）的 Windows 都能运行它，下错架构时能由 `bal:Condition` 给出中文说明，而不是 Windows 的“此应用无法在你的电脑上运行”。架构判断用 Burn 变量 `NativeMachine`（43620 = `0xAA64` 为 ARM64）：
  - x64 版在 ARM64 电脑上拒绝安装，提示改用 arm64 版（否则会装上经仿真运行的 x64 版）。
  - arm64 版只在 ARM64 电脑上安装，其余提示改用 x64 版。Windows 10 1709 之前没有该变量，这些版本也没有 ARM64：x64 版照常安装，arm64 版拒绝。
  - 32 位 Windows 由 `bal:Condition VersionNT64` 拦下并给出中文说明。
- 安装界面就是 MSI 自己的界面（`bal:DisplayInternalUICondition="WixBundleAction = 6"`）：隐私政策、选择安装目录（约束 C2）与直接装 MSI 一致。引导程序自身只有一页“安装”和进度、结果页，文案为自带的中文 `bundle-zh-CN.wxl`（WiX 只自带英文）。
- `MsiPackage` 设为 `Permanent="yes"`、`Visible="yes"`、`Cache="remove"`：Burn 只在有可卸载的包时登记 bundle，所以 exe 不在“应用和功能”中留下自己的条目，也不在 Package Cache 中保留副本；装好的就是 MSI 本身。`DisableModify` / `DisableRemove` 兜底，重启待定等情况下即使留下登记也不显示。这样应用内自动更新（只认 `windows-<arch>-msi`）、`PrimusUpdate` 服务、卸载与 NSIS 迁移全部沿用 ADR 0007，`update-feed` 不变。
- MSI 完成页的“立即启动”用 `WixShellExec` 在界面进程中启动 Primus；经 Burn 安装时界面进程是提权进程，会让 Primus 以管理员身份运行。为此 bundle 给 MSI 传 `PRIMUS_BUNDLE=1`，`Primus.wxs` 此时不显示该勾选框；用户从开始菜单或桌面打开。
- `Bundle.wxs` 的 `UpgradeCode` 固定为 `FD216D87-9A80-4208-A28D-FA4B80241F96`，两个架构共用，与 MSI 的不同，永不改变。
- 发布工作流：每个架构的构建作业在 MSI 冒烟之后，用工作流自身提交中的 `Bundle.wxs` 与脚本打包本架构的 MSI，并在同一运行器上做静默安装 / 卸载冒烟（`scripts/setup-exe-smoke.ps1`：exe 架构与本机一致、只有 MSI 的卸载条目、没有 bundle 登记、版本记录正确、`Primus.exe` 架构与本机一致），两个架构都通过后才发布。
- CI 的 x64 与 ARM64 作业各自构建本架构的 exe，做同样的冒烟，再用它安装基准版本跑一遍 `update-service-smoke.ps1 -BaseExe`：确认 exe 装的副本能被应用内更新静默升级，升级前后“应用和功能”里都只有一个 MSI 条目、没有 bundle 登记。
- 与 MSI 一样不做 Authenticode 签名，首次运行同样有 SmartScreen 提示。

## 后果

- 双击 MSI 打不开的电脑可以改用 exe；每个 exe 与对应 MSI 大小相当（约 50MB）。
- 用户仍要分辨 x64 与 ARM64，下错时 exe 会提示改用哪一个；Release 正文说明“大多数电脑用 x64，骁龙等 ARM 笔记本用 arm64”。
- Release 多两个附件；构建作业多两步。
- 回填早于本 ADR 的版本时没有 exe，`publish-release.sh` 只上传目录里有的 exe（发布工作流设 `REQUIRE_SETUP_EXE=1`，两个都必须有）。
- 早于本 ADR 的标签不能再用发布工作流重建：旧 MSI 不认识 `PRIMUS_BUNDLE`，打进 exe 后完成页的“立即启动”会以管理员身份运行 Primus，所以构建作业在编译前检查标签里的 `Primus.wxs`，不处理 `PRIMUS_BUNDLE` 就失败。只发到公开仓的旧版本仍可用 `backfill_source` 回填到源码仓。
- 经 exe 安装没有“立即启动”，这是为不以管理员身份运行 Primus 所做的取舍。
