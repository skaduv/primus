# apps/windows：Windows 原生界面原型

这是乾元 Primus 的 WinUI 3 界面**原型**，只用于验证界面设计，后续可能整体回滚。

- 不属于正式交付：正式桌面端仍是技术方案中的 Tauri 2 + Next.js 架构（`apps/desktop`），本目录不改变该方案。
- `.github/workflows/windows-ui.yml` 只产出预览截图（GitHub Pages）和测试用的免安装包，不进入 MSI / 发布流程。
- 若原型转为正式方案，再按 AGENTS.md 第 8 节更新技术方案并写 ADR。

## 本地运行

```powershell
cd apps/windows
dotnet run -p:Platform=x64
```
