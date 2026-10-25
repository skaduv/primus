#requires -Version 5.1
#requires -RunAsAdministrator
#requires -Modules Hyper-V
<#
.SYNOPSIS
  把安装测试虚拟机关机后建立「干净」检查点（技术方案第 23 章：安装测试用干净的 Windows 11 虚拟机快照）。

.DESCRIPTION
  在 Hyper-V 宿主机上以管理员身份运行（Windows PowerShell 5.1 或 PowerShell 7 均可）。
  1. 确认虚拟机存在；检查并（-EnableGuestServices 时）启用「来宾服务接口」，供 Copy-VMFile 使用
  2. 正常关机（Stop-VM，来宾内执行关机），等待进入 Off 状态；超时则报错，不强制断电
  3. 已有同名检查点时：-Force 先删除旧检查点，否则报错退出
  4. 建立检查点（关机状态下建立，不含内存状态，还原后是一次冷启动）

  虚拟机需事先在本机创建好（见 scripts/vm/README.md）：Windows 11 开发环境镜像、已完成 OOBE、
  有一个本地管理员账户；不要预装 WebView2 以外的测试对象，也不要装 Primus。

.PARAMETER VMName
  虚拟机名称（Get-VM 显示的名称）。

.PARAMETER CheckpointName
  检查点名称，默认 clean。Reset-PrimusTestVM.ps1 默认还原同名检查点。

.PARAMETER ShutdownTimeoutSec
  等待虚拟机关机的最长秒数，默认 300。

.PARAMETER EnableGuestServices
  若「来宾服务接口」未启用则启用它（Copy-VMFile 依赖它；PowerShell Direct 不依赖）。

.PARAMETER Force
  已存在同名检查点时先删除再重建。

.PARAMETER StartAfter
  建好检查点后重新启动虚拟机。

.EXAMPLE
  .\scripts\vm\New-PrimusTestCheckpoint.ps1 -VMName Primus-Win11 -EnableGuestServices

.EXAMPLE
  .\scripts\vm\New-PrimusTestCheckpoint.ps1 -VMName Primus-Win11 -CheckpointName clean-webview2-missing -Force
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
  [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string] $VMName,
  [ValidateNotNullOrEmpty()] [string] $CheckpointName = 'clean',
  [ValidateRange(30, 3600)] [int] $ShutdownTimeoutSec = 300,
  [switch] $EnableGuestServices,
  [switch] $Force,
  [switch] $StartAfter
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string] $Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }

$vm = Get-VM -Name $VMName -ErrorAction SilentlyContinue
if (-not $vm) { throw "未找到虚拟机「$VMName」。请先在 Hyper-V 管理器中创建（见 scripts/vm/README.md）。" }

# ---- 1. 来宾服务接口 ----
Write-Step '检查集成服务'
$guestService = Get-VMIntegrationService -VM $vm | Where-Object { $_.Id -match '6C09BB55-D683-4DA0-8931-C9BF705F6480' }
if ($guestService -and -not $guestService.Enabled) {
  if ($EnableGuestServices) {
    if ($PSCmdlet.ShouldProcess($VMName, '启用来宾服务接口')) { $guestService | Enable-VMIntegrationService }
    Write-Host '· 已启用来宾服务接口'
  } else {
    Write-Warning '来宾服务接口未启用：Reset-PrimusTestVM.ps1 -CopyMethod GuestServices 将不可用（加 -EnableGuestServices 启用）。'
  }
} elseif ($guestService) {
  Write-Host '· 来宾服务接口已启用'
}
$heartbeat = Get-VMIntegrationService -VM $vm | Where-Object { $_.Id -match '84EAAE65-2F2E-45F5-9BB5-0E857DC8EB47' }
if ($heartbeat -and -not $heartbeat.Enabled) {
  Write-Warning '检测信号（Heartbeat）服务未启用：Reset-PrimusTestVM.ps1 将无法判断来宾是否启动完成。'
}

# ---- 2. 关机 ----
if ($vm.State -ne 'Off') {
  Write-Step "关闭虚拟机（当前状态 $($vm.State)）"
  if ($PSCmdlet.ShouldProcess($VMName, '关机')) {
    Stop-VM -VM $vm -Force
    $deadline = (Get-Date).AddSeconds($ShutdownTimeoutSec)
    while ((Get-VM -Name $VMName).State -ne 'Off') {
      if ((Get-Date) -gt $deadline) {
        throw "虚拟机在 $ShutdownTimeoutSec 秒内未关机。请在来宾中手动关机后重试（不建议强制断电后建立「干净」检查点）。"
      }
      Start-Sleep -Seconds 2
    }
  }
}
Write-Host '· 虚拟机已关机'

# ---- 3. 同名检查点 ----
$existing = @(Get-VMCheckpoint -VMName $VMName -Name $CheckpointName -ErrorAction SilentlyContinue)
if ($existing.Count -gt 0) {
  if (-not $Force) { throw "已存在检查点「$CheckpointName」。确认要替换时加 -Force。" }
  Write-Step "删除旧检查点「$CheckpointName」"
  if ($PSCmdlet.ShouldProcess("$VMName / $CheckpointName", '删除旧检查点')) {
    $existing | Remove-VMCheckpoint -Confirm:$false
  }
}

# ---- 4. 建立检查点 ----
Write-Step "建立检查点「$CheckpointName」"
if ($PSCmdlet.ShouldProcess("$VMName / $CheckpointName", '建立检查点')) {
  Checkpoint-VM -VM $vm -SnapshotName $CheckpointName
  $created = Get-VMCheckpoint -VMName $VMName -Name $CheckpointName
  Write-Host "✓ 已建立检查点「$($created.Name)」（$($created.CreationTime)）" -ForegroundColor Green
}

if ($StartAfter -and $PSCmdlet.ShouldProcess($VMName, '启动')) {
  Start-VM -VM $vm
  Write-Host '· 已启动虚拟机'
}
