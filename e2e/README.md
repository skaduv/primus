# e2e

WebdriverIO + tauri-driver 端到端测试（技术方案第 18 章）。tauri-driver 包装 msedgedriver 驱动 WebView2，因此**只能在 Windows 上运行**。

- 当前：`specs/smoke.e2e.ts` 冒烟——应用启动、标题为“乾元 Primus”、左右栏可隐藏与恢复。CI 的 Windows 作业在编译 `Primus.exe` 后运行。
- 计划：在 Windows 11 虚拟机上每晚与发布前运行完整用例，模型使用 Core 的 Faux provider（脚本化输出）。覆盖首次引导、对话、停止、插话、确认框、分叉、回滚、压缩、子 Agent、计划模式（第 23 章）。

## 本地运行（Windows）

```powershell
pnpm build                                              # 产出 apps/desktop/src-tauri/target/release/Primus.exe
cargo install tauri-driver --locked --version 2.1.0     # 版本见 scripts/version-baseline.json
# 下载与本机 WebView2 运行时同版本的 msedgedriver.exe，然后：
$env:PRIMUS_NATIVE_DRIVER = "C:\path\to\msedgedriver.exe"
pnpm test:e2e
```

| 环境变量 | 作用 |
|---|---|
| `PRIMUS_E2E_APP` | 被测程序路径，默认 `../apps/desktop/src-tauri/target/release/Primus.exe` |
| `PRIMUS_NATIVE_DRIVER` | 传给 tauri-driver 的 `--native-driver`（msedgedriver 路径）；不设时 tauri-driver 从 PATH 查找 |

`wdio.conf.ts` 在每个会话前启动 `~/.cargo/bin/tauri-driver` 并等待 `127.0.0.1:4444` 就绪，会话结束或进程退出时关闭它。

类型检查（任何平台）：`pnpm --filter @primus/e2e typecheck`。根目录 `pnpm test`（Vitest）不包含 e2e。
