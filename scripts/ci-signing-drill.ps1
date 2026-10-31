# CI 签名演练（技术方案第 3.3.4 节）：正式代码签名证书与 updater 私钥只放在发布用的 CI 密钥库（第 22.3 节），
# PR 与日常推送拿不到。为了让每次 CI 都完整走一遍签名流程（签 Primus.exe → 签 MSI → tauri signer 生成 .sig
# → 校验 .sig → signtool verify /pa 三个文件），这里临时生成一次性的自签名代码签名证书和 updater 密钥：
#
#   - 证书：New-SelfSignedCertificate 生成到 CurrentUser\My（私钥不可导出、2 天后过期），公钥证书导入
#     LocalMachine\Root 与 TrustedPublisher，使 signtool verify /pa 在本运行器上能建立信任链
#     （GitHub 托管运行器以管理员运行，导入不弹窗；运行器用完即销毁，因此脚本拒绝在自托管运行器上运行）
#   - updater 密钥：tauri signer generate 写到 RUNNER_TEMP，随机口令
#   - 写入 GITHUB_ENV：PRIMUS_SIGN_CERT_SHA1、PRIMUS_SIGN_TIMESTAMP_URL、TAURI_SIGNING_PRIVATE_KEY_PATH、
#     TAURI_SIGNING_PRIVATE_KEY_PASSWORD（已打码）、TAURI_SIGNING_PUBLIC_KEY、PRIMUS_REQUIRE_SIGNING=1
#
# 这样产出的安装包只在本运行器上受信任，不能对外分发；发布流程改用密钥库中的正式证书与私钥。
# 用法（仓库根目录，pwsh）：./scripts/ci-signing-drill.ps1 [-TimestampUrl <RFC 3161 时间戳服务器>]
param(
  [string]$TimestampUrl = "http://timestamp.digicert.com"
)
$ErrorActionPreference = "Stop"
# 自托管运行器同样有 GITHUB_ENV / RUNNER_TEMP，但不会用完即销毁，导入的演练证书会被长期信任：只允许 GitHub 托管运行器
if (-not $env:GITHUB_ENV -or -not $env:RUNNER_TEMP -or $env:RUNNER_ENVIRONMENT -ne "github-hosted") {
  throw "只能在 GitHub 托管运行器上运行（会改动本机受信任根证书；RUNNER_ENVIRONMENT=$env:RUNNER_ENVIRONMENT）"
}

$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=Primus CI Signing Drill, O=Primus CI" `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
  -KeyExportPolicy NonExportable `
  -NotAfter (Get-Date).AddDays(2)
$cer = Join-Path $env:RUNNER_TEMP "primus-ci-signing-drill.cer"
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
# 运行器镜像不同，写本机证书存储的权限也不同（windows-11-arm 的 VS2026 镜像上 Import-Certificate 写
# LocalMachine\Root 报 E_ACCESSDENIED）：依次尝试 Import-Certificate → certutil -addstore → 以 RunAs 提升的
# certutil（UAC 对管理员自动批准时不弹窗），全部失败才报错，并打印当前令牌是否提升以便排查。
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Host "当前进程$(if ($elevated) { '已' } else { '未' })以管理员权限运行（$([Security.Principal.WindowsIdentity]::GetCurrent().Name)）"
function Add-MachineTrust([string]$Store) {
  try {
    Import-Certificate -FilePath $cer -CertStoreLocation "Cert:\LocalMachine\$Store" -ErrorAction Stop | Out-Null
    return
  } catch {
    Write-Host "Import-Certificate 写 LocalMachine\$Store 失败：$($_.Exception.Message)，改用 certutil"
  }
  & certutil.exe -f -addstore $Store $cer | Out-Host
  if ($LASTEXITCODE -eq 0) { return }
  Write-Host "certutil -addstore $Store 失败（退出码 $LASTEXITCODE），改用提升后的 certutil"
  $p = Start-Process -FilePath certutil.exe -ArgumentList @("-f", "-addstore", $Store, "`"$cer`"") -Verb RunAs -Wait -PassThru -WindowStyle Hidden
  if ($p.ExitCode -ne 0) { throw "无法把演练证书加入 LocalMachine\$Store（提升后的 certutil 退出码 $($p.ExitCode)）" }
}
Add-MachineTrust "Root"
Add-MachineTrust "TrustedPublisher"
foreach ($store in "Root", "TrustedPublisher") {
  if (-not (Get-ChildItem "Cert:\LocalMachine\$store" | Where-Object Thumbprint -eq $cert.Thumbprint)) {
    throw "演练证书未出现在 LocalMachine\$store 中"
  }
}
Write-Host "演练证书：$($cert.Subject)，指纹 $($cert.Thumbprint)，有效期至 $($cert.NotAfter)"

$key = Join-Path $env:RUNNER_TEMP "primus-ci-updater.key"
$password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
Write-Host "::add-mask::$password"
pnpm --filter @primus/desktop tauri signer generate --ci --force --password $password --write-keys $key | Out-Null
if ($LASTEXITCODE -ne 0) { throw "tauri signer generate 失败（退出码 $LASTEXITCODE）" }
if (-not (Test-Path -LiteralPath "$key.pub")) { throw "未生成 updater 公钥：$key.pub" }
$pubkey = (Get-Content -LiteralPath "$key.pub" -Raw).Trim()

@(
  "PRIMUS_SIGN_CERT_SHA1=$($cert.Thumbprint)",
  "PRIMUS_SIGN_TIMESTAMP_URL=$TimestampUrl",
  "TAURI_SIGNING_PRIVATE_KEY_PATH=$key",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$password",
  "TAURI_SIGNING_PUBLIC_KEY=$pubkey",
  "PRIMUS_REQUIRE_SIGNING=1"
) | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
Write-Host "已生成一次性 updater 密钥（$key），签名环境变量已写入 GITHUB_ENV"
