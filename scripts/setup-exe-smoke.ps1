#requires -Version 7.2
<#
.SYNOPSIS
  通用安装程序 PrimusSetup_<ver>_zh-CN.exe 的静默安装 / 卸载冒烟（ADR 0011）。CI 的 x64 作业与发布工作流共用。

.DESCRIPTION
  1. 运行 exe /quiet /norestart /log 静默安装，失败时输出 Burn 日志与 MSI 日志末尾
  2. 只有一个名为“乾元 Primus”的卸载条目，且是 MSI（WindowsInstaller = 1），没有 Burn bundle 的登记（BundleUpgradeCode）：
     exe 只是载体，装好的就是 MSI 本身
  3. HKLM\Software\Primus 的 Version 为本版本；安装目录里的 Primus.exe 的 PE 架构与本机原生架构一致
     （x64 = 0x8664，ARM64 = 0xAA64），确认 exe 选对了内嵌的 MSI
  4. msiexec /x 按产品代码静默卸载：卸载条目消失；清理卸载时保留下来的 data，便于重复运行

  需要管理员权限（按机器安装）。任何一步不符合预期即抛错，退出码非 0。

.PARAMETER Exe
  PrimusSetup_<ver>_zh-CN.exe 路径。

.PARAMETER Version
  期望的版本（SemVer），默认取 apps/desktop/src-tauri/tauri.conf.json 的 version。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $Exe,
  [string] $Version,
  [string] $LogDir = (Join-Path ([IO.Path]::GetTempPath()) 'primus-setup-exe-smoke'),
  [int] $TimeoutSeconds = 600
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProductName = '乾元 Primus'
$BundleUpgradeCode = '{FD216D87-9A80-4208-A28D-FA4B80241F96}'
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Version) {
  $Version = (Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\desktop\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
}
$Exe = (Resolve-Path -LiteralPath $Exe).Path
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Step([string] $Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Assert-True([bool] $Condition, [string] $Message) {
  if (-not $Condition) { throw "✗ $Message" }
  Write-Host "  ✓ $Message"
}

function Get-UninstallEntries {
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  @(Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |
      Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -eq $ProductName })
}

function Get-BundleEntries {
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  @(Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |
      Where-Object { $_.PSObject.Properties['BundleUpgradeCode'] -and (@($_.BundleUpgradeCode) -contains $BundleUpgradeCode) })
}

function Show-LogTail([string] $Pattern) {
  Get-ChildItem -Path $LogDir -Filter $Pattern -File -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "---- $($_.FullName)（末尾 80 行）----"
    Get-Content -LiteralPath $_.FullName -Tail 80 | ForEach-Object { Write-Host $_ }
  }
}

# 读 PE 头的 Machine 字段（IMAGE_FILE_HEADER 的前两个字节）
function Get-PeMachine([string] $Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
  return [BitConverter]::ToUInt16($bytes, $peOffset + 4)
}

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw '需要以管理员身份运行（按机器安装）'
}
Assert-True ((Get-UninstallEntries).Count -eq 0) "安装前没有已装的 $ProductName"

$osArch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture
$expectedMachine = switch ($osArch) {
  'X64' { 0x8664 }
  'Arm64' { 0xAA64 }
  default { throw "不支持的系统架构 $osArch" }
}

Write-Step "静默安装 $(Split-Path -Leaf $Exe)（系统架构 $osArch）"
$log = Join-Path $LogDir 'setup.log'
$process = Start-Process -FilePath $Exe -ArgumentList @('/quiet', '/norestart', '/log', "`"$log`"") -PassThru
$null = $process.Handle
if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
  Show-LogTail 'setup*.log'
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw "✗ 安装超过 $TimeoutSeconds 秒未结束"
}
if ($process.ExitCode -notin 0, 3010) {
  Show-LogTail 'setup*.log'
  throw "✗ 安装失败，退出码 $($process.ExitCode)"
}
Write-Host "  ✓ 安装完成（退出码 $($process.ExitCode)）"

Write-Step '检查安装结果'
$entries = Get-UninstallEntries
Assert-True ($entries.Count -eq 1) "“应用和功能”中恰有一个 $ProductName（实际 $($entries.Count) 个）"
$entry = $entries[0]
Assert-True ($entry.PSObject.Properties['WindowsInstaller'] -and $entry.WindowsInstaller -eq 1) '该条目是 MSI，不是 exe 的 bundle'
Assert-True ((Get-BundleEntries).Count -eq 0) '没有留下 Burn bundle 的登记'
$productCode = $entry.PSChildName
Assert-True ($productCode -match '^\{[0-9A-F-]{36}\}$') "产品代码 $productCode"

$recorded = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Primus' -ErrorAction SilentlyContinue
Assert-True ($null -ne $recorded -and $recorded.Version -eq $Version) "HKLM\Software\Primus\Version 为 $Version"
$installDir = [string] $recorded.InstallDir
$mainExe = Join-Path $installDir 'Primus.exe'
Assert-True (Test-Path -LiteralPath $mainExe) "已安装 $mainExe"
$machine = Get-PeMachine $mainExe
Assert-True ($machine -eq $expectedMachine) ("Primus.exe 的架构 0x{0:X4} 与本机一致" -f $machine)

Write-Step '静默卸载'
$uninstallLog = Join-Path $LogDir 'uninstall.log'
$process = Start-Process -FilePath 'msiexec.exe' -ArgumentList "/x $productCode /qn /norestart /l*v `"$uninstallLog`"" -PassThru
$null = $process.Handle
if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw "✗ 卸载超过 $TimeoutSeconds 秒未结束（日志 $uninstallLog）"
}
if ($process.ExitCode -notin 0, 3010) {
  Show-LogTail 'uninstall.log'
  throw "✗ 卸载失败，退出码 $($process.ExitCode)"
}
Assert-True ((Get-UninstallEntries).Count -eq 0) '卸载条目已移除'
Assert-True (-not (Test-Path -LiteralPath $mainExe)) 'Primus.exe 已删除'

# data 在卸载时保留（Permanent 组件）；冒烟结束清掉，便于后续步骤与重复运行
$dataDir = Join-Path $installDir 'data'
if (Test-Path -LiteralPath $dataDir) { Remove-Item -LiteralPath $dataDir -Recurse -Force }
if ((Test-Path -LiteralPath $installDir) -and -not (Get-ChildItem -LiteralPath $installDir -Force)) {
  Remove-Item -LiteralPath $installDir -Force
}

Write-Host "`n✓ 通用安装程序冒烟通过" -ForegroundColor Green
