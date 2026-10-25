#requires -Version 7.2
<#
.SYNOPSIS
  MSI 静默安装 / 卸载冒烟（技术方案第 3.2、3.3、23 章）。CI 的 Windows 作业与安装测试虚拟机共用。

.DESCRIPTION
  1. msiexec /i 静默安装到指定目录（默认 C:\Program Files\Primus），失败时输出安装日志末尾
  2. 检查安装布局：Primus.exe、resources\runtime\node.exe、resources\agent-core（按 manifest.json 逐个校验
     SHA-256，确认 WiX 的 Files 收集完整）、第一方扩展 primus-bundle.js、data 目录，以及卸载信息
  3. 用安装目录里的 node.exe 跑 Core RPC 冒烟（scripts/smoke-core-rpc.mjs --entry/--node）
  4. msiexec /x 静默卸载，检查程序文件已移除、卸载信息已清除

  需要管理员权限（按机器安装）。退出码非 0 即失败。

.PARAMETER Msi
  MSI 路径。

.PARAMETER InstallDir
  安装目录（传给 INSTALLFOLDER 属性），默认 "$env:ProgramFiles\Primus"。

.PARAMETER Node
  运行 smoke-core-rpc.mjs 的 Node.js（只用来驱动冒烟脚本；Core 本身由安装目录里的 node.exe 运行）。
  默认取 PATH 中的 node；找不到时跳过 RPC 冒烟。

.PARAMETER KeepInstalled
  只安装与检查，不卸载（虚拟机手工测试时使用）。

.EXAMPLE
  pwsh -File scripts/msi-smoke.ps1 -Msi out/Primus_0.0.0_x64_zh-CN.msi
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $Msi,
  [string] $InstallDir = (Join-Path $env:ProgramFiles 'Primus'),
  [string] $Node,
  [string] $LogDir = (Join-Path ([IO.Path]::GetTempPath()) 'primus-msi-smoke'),
  [switch] $KeepInstalled
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProductName = '乾元 Primus'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Msi = (Resolve-Path -LiteralPath $Msi).Path
$InstallDir = [IO.Path]::GetFullPath($InstallDir.TrimEnd('\'))
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Step([string] $Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Assert-True([bool] $Condition, [string] $Message) {
  if (-not $Condition) { throw "✗ $Message" }
  Write-Host "  ✓ $Message"
}

function Test-Administrator {
  $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# msiexec 的命令行由它自己解析：带空格的路径与属性值都要加引号；Start-Process 的数组参数不会自动加引号
function Invoke-Msiexec([string] $Action, [string] $LogName, [string[]] $Properties = @()) {
  $log = Join-Path $LogDir $LogName
  $argumentLine = @($Action, "`"$Msi`"") + $Properties + @('/qn', '/norestart', '/l*v', "`"$log`"")
  Write-Host "  msiexec $($argumentLine -join ' ')"
  $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList ($argumentLine -join ' ') -Wait -PassThru
  # 0 成功；3010 成功但需重启（ERROR_SUCCESS_REBOOT_REQUIRED）
  if ($process.ExitCode -notin 0, 3010) {
    if (Test-Path -LiteralPath $log) {
      Write-Host "---- $log（末尾 120 行）----"
      Get-Content -LiteralPath $log -Tail 120 | ForEach-Object { Write-Host $_ }
    }
    throw "✗ msiexec $Action 失败，退出码 $($process.ExitCode)（日志 $log）"
  }
  Write-Host "  ✓ msiexec $Action 完成（退出码 $($process.ExitCode)）"
}

function Get-UninstallEntry {
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |
    Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -eq $ProductName }
}

if (-not (Test-Administrator)) { throw '✗ 需要以管理员身份运行（MSI 按机器安装）' }
if (Get-UninstallEntry) { throw "✗ 本机已安装 $ProductName，请先卸载或在干净环境中运行" }

# ---- 1. 安装 ----
Write-Step "静默安装 $Msi → $InstallDir"
Invoke-Msiexec -Action '/i' -LogName 'install.log' -Properties @("INSTALLFOLDER=`"$InstallDir`"")

# ---- 2. 检查安装布局 ----
Write-Step '检查安装布局（技术方案第 3.2 节）'
$resources = Join-Path $InstallDir 'resources'
$coreDir = Join-Path $resources 'agent-core'
$nodeExe = Join-Path $resources 'runtime\node.exe'
foreach ($relative in @(
    'Primus.exe',
    'resources\runtime\node.exe',
    'resources\runtime\LICENSE',
    'resources\agent-core\rpc-entry.js',
    'resources\agent-core\cli.js',
    'resources\agent-core\package.json',
    'resources\agent-core\manifest.json',
    'resources\agent-core\extensions\primus-bundle.js'
  )) {
  Assert-True (Test-Path -LiteralPath (Join-Path $InstallDir $relative) -PathType Leaf) "存在 $relative"
}
Assert-True (Test-Path -LiteralPath (Join-Path $InstallDir 'data') -PathType Container) '存在 data 目录'

$manifest = Get-Content -LiteralPath (Join-Path $coreDir 'manifest.json') -Raw | ConvertFrom-Json
$mismatched = @()
foreach ($file in $manifest.files) {
  $path = Join-Path $coreDir ($file.path -replace '/', '\')
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $mismatched += "缺少 $($file.path)"; continue }
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $file.sha256) { $mismatched += "内容不符 $($file.path)" }
}
if ($mismatched.Count -gt 0) { $mismatched | ForEach-Object { Write-Host "  - $_" } }
Assert-True ($mismatched.Count -eq 0) "resources\agent-core 与 manifest.json 一致（$(@($manifest.files).Count) 个文件）"

$signature = Get-AuthenticodeSignature -FilePath $nodeExe
Assert-True ($signature.Status -eq 'Valid') "安装后的 node.exe 官方签名有效（$($signature.Status)）"

$entry = Get-UninstallEntry
Assert-True ($null -ne $entry) "已写入卸载信息（$ProductName）"
Write-Host "  · 版本 $($entry.DisplayVersion)，发布者 $($entry.Publisher)"

# ---- 3. 用安装目录中的运行时跑 Core RPC 冒烟 ----
if (-not $Node) { $Node = (Get-Command node -ErrorAction SilentlyContinue)?.Source }
$smokeScript = Join-Path $RepoRoot 'scripts\smoke-core-rpc.mjs'
if ($Node -and (Test-Path -LiteralPath $smokeScript)) {
  Write-Step 'Core RPC 冒烟（安装目录中的 node.exe + agent-core）'
  & $Node $smokeScript --entry (Join-Path $coreDir 'rpc-entry.js') --node $nodeExe
  Assert-True ($LASTEXITCODE -eq 0) '安装后的 Core 响应 get_state'
} else {
  Write-Host "`n· 未找到 node 或 smoke-core-rpc.mjs，跳过 Core RPC 冒烟"
}

if ($KeepInstalled) {
  Write-Step "按 -KeepInstalled 保留安装（$InstallDir）"
  exit 0
}

# ---- 4. 卸载 ----
Write-Step '静默卸载'
Invoke-Msiexec -Action '/x' -LogName 'uninstall.log'
Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'Primus.exe'))) '已移除 Primus.exe'
Assert-True (-not (Test-Path -LiteralPath $coreDir)) '已移除 resources\agent-core'
Assert-True ($null -eq (Get-UninstallEntry)) '已清除卸载信息'

Write-Host "`n✓ MSI 安装 / 卸载冒烟通过" -ForegroundColor Green
