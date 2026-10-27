# 乾元 Primus Windows 原生界面预览：启动构建好的 Primus.exe，等开场动画结束后截取主窗口
# 用法：pwsh tools/capture-preview.ps1 -Exe <Primus.exe 路径> -OutDir <输出目录>
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [int]$SettleSeconds = 5
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PrimusWin32 {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT rect, int size);
}
"@
[PrimusWin32]::SetProcessDPIAware() | Out-Null

function Save-Region([int]$x, [int]$y, [int]$w, [int]$h, [string]$path) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

$proc = Start-Process -FilePath $Exe -WorkingDirectory (Split-Path $Exe) -PassThru

# 等主窗口出现（最多 60 秒）
$deadline = (Get-Date).AddSeconds(60)
while ($proc.MainWindowHandle -eq [IntPtr]::Zero) {
    if ($proc.HasExited) { throw "Primus.exe 启动后立即退出，退出码 $($proc.ExitCode)" }
    if ((Get-Date) -gt $deadline) { throw "60 秒内没有等到 Primus 主窗口" }
    Start-Sleep -Milliseconds 250
    $proc.Refresh()
}
$hwnd = $proc.MainWindowHandle
[PrimusWin32]::SetForegroundWindow($hwnd) | Out-Null

# 开场画面约 1 秒后淡出，再留出余量
Start-Sleep -Seconds $SettleSeconds

# 优先用 DWM 的可见边界（不含阴影），失败再退回 GetWindowRect
$rect = New-Object PrimusWin32+RECT
$hr = [PrimusWin32]::DwmGetWindowAttribute($hwnd, 9, [ref]$rect, [System.Runtime.InteropServices.Marshal]::SizeOf($rect))
if ($hr -ne 0) { [PrimusWin32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null }
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { throw "主窗口尺寸异常：${w}x${h}" }

Save-Region $rect.Left $rect.Top $w $h (Join-Path $OutDir "main.png")

# 整屏截图，便于排查窗口位置或系统背景材质的问题
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Save-Region $b.X $b.Y $b.Width $b.Height (Join-Path $OutDir "desktop.png")

Stop-Process -Id $proc.Id -Force
Write-Host "已截图：主窗口 ${w}x${h}，桌面 $($b.Width)x$($b.Height)"
