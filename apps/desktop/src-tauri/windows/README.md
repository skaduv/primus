# windows

- `Primus.wxs`：WiX 7 安装包定义（第 3.3 节）。`UpgradeCode` 一经确定永不改变。
- `webview2/`：WebView2 引导程序（约 1.8MB，缺失或版本过低时运行）。
- `nsis/`：备选 NSIS 安装脚本（第 3.4 节）。

构建：`wix build Primus.wxs -arch x64 -culture zh-CN -acceptEula wix7 -ext WixToolset.UI.wixext -ext WixToolset.Util.wixext -bindpath app=target/release -bindpath core=dist/agent-core -bindpath runtime=dist/runtime -d ProductVersion=<x.y.z.0> -o out/Primus_<ver>_x64_zh-CN.msi`
