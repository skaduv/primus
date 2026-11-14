# ADR 0012：exe 与 MSI 统一安装界面

- 状态：已采纳（2026-11-14）
- 取代：ADR 0011 中“exe 显示 MSI 自己的界面”一条

## 背景

ADR 0011 的 exe（Burn）先显示自己的欢迎 / 安装页，再用 `bal:DisplayInternalUICondition` 弹出 MSI 的整套 WixUI_InstallDir 向导（欢迎 → 许可 → 目录 → 确认 → 进度 → 完成）。用户反馈安装过程中界面闪烁，原因：

1. 两个窗口来回切换：Burn 窗口与 MSI 窗口交替出现在前台，Burn 的进度页在 MSI 窗口后面持续重绘。
2. WixUI 一共 6 个对话框，每次“下一步”都销毁旧窗口、创建新窗口；还会先闪一下 PrepareDlg。
3. 进度页订阅 `ActionText`，每个安装动作都改一次透明文字，整行反复擦除重画。
4. 两套界面风格、字体（Tahoma 无中文字形）、按钮位置都不同，直接装 MSI 与装 exe 看起来像两个程序。

## 决定

- 设计一套界面，两种安装方式页面、文案、按钮位置一一对应：准备安装（隐私政策 + 同意 + 安装位置）→ 正在安装（进度条 + 一行固定说明）→ 完成（立即启动 / 完成）| 安装未完成 | 已取消。字体统一为 Microsoft YaHei UI，页眉白底、标志在右。
- exe：WixStdBA 自定义主题 `windows/setup-theme.xml` + `bundle-zh-CN.wxl`，自己画全部页面；MSI 不显示内部界面，安装目录经 `MsiProperty INSTALLFOLDER` 传入。目录逻辑与 MSI 相同：已装过（`HKLM\Software\Primus\InstallDir`）或从 NSIS 迁移时沿用原目录且锁定。“立即启动”由 exe 的非提权界面进程（`LaunchTarget`）执行。
- MSI：`windows/PrimusUI.wxi` 取代 `WixUI_InstallDir`，只有 3 个主页面（已安装时为“修复 / 卸载”页）；进度页只订阅 `SetProgress`，不订阅 `ActionText` / `ActionData`；中文公共对话框（浏览、取消确认、磁盘空间、文件占用、错误）沿用 WixUI。
- 两边文案一致由 `scripts/build-setup-exe.test.ts` 检查。

## 影响

- `UpgradeCode`、数据目录与安装目录 ACL、NSIS 迁移、PrimusUpdate 服务、静默参数均不变。
- `PRIMUS_BUNDLE` 仍由 exe 传入；MSI 在 exe 下本来就不再显示界面，保留只为兼容。
- 主题由 thmutil 在运行时解析，构建期不校验：改主题后须在 Windows 上实际运行一次 exe（含高 DPI 125%/150%）。
