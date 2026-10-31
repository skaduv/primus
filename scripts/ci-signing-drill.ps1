# CI 签名演练（技术方案第 3.3.4 节）：正式代码签名证书与 updater 私钥只放在发布用的 CI 密钥库（第 22.3 节），
# PR 与日常推送拿不到。为了让每次 CI 都完整走一遍签名流程（签 Primus.exe → 签 MSI → tauri signer 生成 .sig
# → 校验 .sig → signtool verify /pa 三个文件），这里临时生成一次性的自签名代码签名证书和 updater 密钥：
#
#   - 证书：New-SelfSignedCertificate 生成到 CurrentUser\My（私钥不可导出、2 天后过期），公钥证书导入
#     LocalMachine\Root 与 TrustedPublisher，使 signtool verify /pa 在本运行器上能建立信任链
#     （GitHub 托管运行器以管理员运行，导入不弹窗；运行器用完即销毁）
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
if (-not $env:GITHUB_ENV -or -not $env:RUNNER_TEMP) { throw "只能在 GitHub Actions 运行器上运行（会改动本机受信任根证书）" }

$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=Primus CI Signing Drill, O=Primus CI" `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
  -KeyExportPolicy NonExportable `
  -NotAfter (Get-Date).AddDays(2)
$cer = Join-Path $env:RUNNER_TEMP "primus-ci-signing-drill.cer"
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null
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
