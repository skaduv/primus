# 安装测试虚拟机（Hyper-V）

技术方案第 23 章要求：发布前在**干净的 Windows 11 虚拟机快照**上做安装测试。这里的两个脚本在 Hyper-V 宿主机上
把一台测试虚拟机固定为「clean」检查点，并能一键回到该状态、把 MSI 送进去跑冒烟、把日志拉回来。
手工测试项见 [docs/安装测试清单.md](../../docs/安装测试清单.md)。

| 脚本 | 作用 |
| --- | --- |
| `New-PrimusTestCheckpoint.ps1` | 检查集成服务（可选启用来宾服务接口）→ 正常关机 → 建立检查点（默认 `clean`，同名已存在须加 `-Force`） |
| `Reset-PrimusTestVM.ps1` | 断电并还原检查点 → 启动、等待检测信号与 PowerShell Direct → 复制 MSI、`msi-smoke.ps1`、`smoke-core-rpc.mjs` 到来宾 `C:\PrimusTest` → 可选执行冒烟 → 拉回日志到宿主机 `.\vm-logs\<VM>-<时间>\` |

两个脚本都要求宿主机**管理员**身份、已启用 Hyper-V 功能（`Hyper-V` PowerShell 模块），Windows PowerShell 5.1 与
PowerShell 7 均可运行。虚拟机名、检查点名、来宾工作目录都是参数；来宾凭据只通过 `-Credential` 或运行时
`Get-Credential` 输入，脚本不保存、不打印。两者都支持 `-WhatIf`。

## 一次性准备：在本机创建虚拟机

虚拟机需要你在自己的电脑上先建好（脚本不负责创建）：

1. 开启 Hyper-V（「启用或关闭 Windows 功能」→ Hyper-V，需 Windows 专业版/企业版），重启。
2. 准备 Windows 11 镜像：已有微软 **Windows 11 开发环境虚拟机**（Hyper-V 版）可直接导入使用；该下载页
   （developer.microsoft.com/windows/downloads/virtual-machines）2026-10 核实时已跳转到通用开发工具页、不再提供下载，
   没有现成镜像时用 Windows 11 ISO（microsoft.com/software-download/windows11，或评估中心的企业版评估 ISO）新建
   第 2 代虚拟机安装：启用 TPM 与安全启动、≥4GB 内存、≥64GB 磁盘。
3. 在虚拟机设置 → **集成服务**中勾选「检测信号」与「**来宾服务**」（后者供 `-CopyMethod GuestServices` 的 Copy-VMFile 使用；
   默认的 PowerShell Direct 不需要它，也不需要网络）。
4. 启动虚拟机完成首次设置；确认有一个本地管理员账户。PowerShell Direct 用该账户登录：
   - 若冒烟报「会话没有管理员令牌」（非内置 Administrator 的本地管理员账户受 UAC 远程限制），
     改用内置 Administrator，或在来宾内执行
     `New-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System -Name LocalAccountTokenFilterPolicy -Value 1 -PropertyType DWord -Force`
     后再建检查点。
5. 保持干净：**不要**安装 Primus，不要装 PowerShell 7（冒烟用 `-PwshZip` 临时带进去）。WebView2 的两种情况可以各建一个检查点：
   Windows 11 自带 WebView2 运行时（对应默认 `clean`）；如需测试缺失引导，可在另一台虚拟机或另一个检查点中
   卸载 WebView2 运行时后建立 `clean-no-webview2`。
6. 关闭 Windows 更新的自动重启（或在建检查点前把更新装完），避免测试中途重启。

然后在宿主机上（管理员 PowerShell，仓库根目录）：

```powershell
.\scripts\vm\New-PrimusTestCheckpoint.ps1 -VMName Primus-Win11 -EnableGuestServices
```

## 每次测试：一键回到干净状态

```powershell
# 只还原并启动，随后按清单手工测试
.\scripts\vm\Reset-PrimusTestVM.ps1 -VMName Primus-Win11

# 还原 → 复制 MSI → 在来宾内跑 msi-smoke.ps1（中文与空格目录）→ 拉回日志
.\scripts\vm\Reset-PrimusTestVM.ps1 -VMName Primus-Win11 `
  -Msi .\out\Primus_0.1.0_x64_zh-CN.msi -RunSmoke `
  -InstallDir 'C:\测试 目录\乾元 Primus' `
  -PwshZip .\PowerShell-7.4.6-win-x64.zip

# 升级测试：两个 MSI 一起复制进去；冒烟对第一个执行并保留安装（-KeepInstalled），再在来宾内手工安装第二个
.\scripts\vm\Reset-PrimusTestVM.ps1 -VMName Primus-Win11 -Msi .\old.msi, .\new.msi -RunSmoke -KeepInstalled -PwshZip .\pwsh.zip
```

- `msi-smoke.ps1` 需要 PowerShell 7.2+：来宾内没有 `pwsh` 时用 `-PwshZip` 传入官方便携包
  （GitHub PowerShell Releases 的 `PowerShell-7.x.y-win-x64.zip`），只解压到 `C:\PrimusTest\tools\pwsh`，不安装。
- 来宾内没有 Node.js 时，`msi-smoke.ps1` 会跳过 Core RPC 冒烟；没有 gsudo 时只做 data 的 ACL 检查，
  不做中完整性级别写入（这两项在 CI 的 Windows 作业中覆盖）。
- 拉回的日志：`guest-logs\msi-smoke\`（`install.log` / `uninstall.log` 等 msiexec 详细日志、`console.log`），
  以及 `app-logs\`（`<安装目录>\data\shared\logs`，存在时）。
- 冒烟失败时脚本退出码非 0，日志照样拉回；虚拟机保持运行，便于登录排查。下次运行会直接断电还原。
