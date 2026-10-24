# 乾元（Primus）

面向所有人的桌面 Agent 应用。用户选择一个项目目录，用自然语言让 Agent 读代码、改代码、跑命令、查问题。

- Agent 的全部能力来自 **Agent Core**（上游开源 Agent 内核源码，位于 `agent-core/`）
- 桌面端负责界面、进程管理、配置与打包
- 首发平台：**Windows 11 x64**，随后 macOS、Linux
- 交付形态：一个安装包，首选 **MSI**（WiX 7），备选 NSIS

> 完整设计见 [docs/技术方案-V5.3.md](docs/技术方案-V5.3.md)。参与开发（包括 AI 编码 Agent）前请先读 [AGENTS.md](AGENTS.md)。

## 架构

```
前端 WebView2（Next.js + React）
    │  Tauri invoke / Channel（16ms 合批）
    ▼
薄壳 Primus.exe（Tauri 2 / Rust）—— 进程监管 · 数据目录 · 凭证 · 文件监听 · 更新
    │  stdin / stdout JSONL（每个运行中的会话一个 Core 进程，默认上限 4）
    ▼
node.exe agent-core/rpc-entry.js + 第一方扩展 primus-bundle.js
```

| 组件 | 技术 | 职责 |
|---|---|---|
| 前端 | Next.js 16（静态导出）、React 19.3、TypeScript 7、Tailwind 4、Radix UI、zustand 5 | 全部界面；用户操作 → RPC 命令；RPC 事件 → 时间线 |
| 薄壳 | Tauri 2.12、Rust 1.99.1、tokio、rusqlite、windows-rs | 进程监管、JSONL 转发、数据目录、凭证（DPAPI）、文件监听、托盘、更新 |
| Agent Core | `agent-core/` 源码构建的 JS 产物 + 内置 Node.js 24 LTS | Agent 循环、模型调用、工具、会话、压缩、技能、MCP |
| 第一方扩展 | TypeScript，打包为 `primus-bundle.js` | 守卫、上下文、检查点、子 Agent、计划模式等 |


## 目录结构

```
primus/
├─ apps/desktop/
│  ├─ src/                 前端（Next.js 静态导出）
│  │  ├─ app/              App Router 页面（全部客户端组件）
│  │  ├─ stores/           zustand 全局 store 与会话 store
│  │  ├─ lib/platform/     平台接口：tauri/ 与 mock/ 两套实现
│  │  ├─ features/         chat、sessions、context、changes、files、plan、settings、capabilities、usage
│  │  ├─ rpc/              RPC 客户端、事件归并、流式消息重建
│  │  ├─ components/       通用组件
│  │  └─ workers/          Shiki、Markdown
│  └─ src-tauri/           薄壳（Rust）
│     ├─ src/              supervisor、rpc_bridge、job、paths、core_config、vault、
│     │                    session_index、fs_watch、git、shell_detect、tray、updater、platform
│     ├─ windows/          Primus.wxs（WiX 7）、WebView2 引导程序、NSIS 备用脚本
│     ├─ capabilities/     Tauri 权限声明
│     └─ tauri.conf.json
├─ packages/
│  ├─ extensions/          第一方 Core 扩展 → primus-bundle.js
│  ├─ protocol/            RPC 与 primus:* 数据的 TS 类型
│  └─ ui/                  共享 UI 组件
├─ agent-core/             Agent Core 完整源码（git subtree 引入，当前 v1.4.0；改动见 agent-core/PATCHES.md）
├─ e2e/                    WebdriverIO + tauri-driver
├─ scripts/                build-core.mjs、检查脚本、MSI 构建脚本
└─ docs/                   技术方案、ADR、用户手册
```

## 开发环境

| 工具 | 版本 |
|---|---|
| Node.js | 24.22.1 LTS（见 `.node-version`） |
| pnpm | 12.15.0 |
| Rust | 1.99.1（见 `rust-toolchain.toml`） |
| WiX Toolset | 7.0.0（仅 Windows，打包 MSI 时需要） |
| 系统 | Windows 11 x64 + MSVC 生成工具 + WebView2 |

所有依赖锁定精确版本，只用最新**稳定版**；Renovate 每月提交一次升级 PR。

## 常用命令

```bash
pnpm install --frozen-lockfile   # 安装依赖
pnpm dev:web                     # 浏览器预览前端（mock 平台 + 假 Core 事件流，无需 Rust/Windows）
pnpm dev                         # Tauri 开发模式（数据目录为仓库下 .dev-data/）
pnpm build:core                  # 构建 Agent Core（npm ci + 锁定模型目录 + 离线构建）
pnpm smoke:core                  # Agent Core RPC 冒烟：发送 get_state 应收到 response
pnpm build:extensions            # 构建第一方扩展 → dist/agent-core/extensions/primus-bundle.js
pnpm build                       # 完整构建 Primus.exe（不打包）
pnpm lint                        # Biome
pnpm test                        # Vitest
cargo nextest run                # Rust 单测（在 apps/desktop/src-tauri 下）
```

## CI 与依赖升级

- GitHub Actions（`.github/workflows/ci.yml`）：每次推送 `dev` / `main` 与每个指向 `main` 的 PR，先在 Linux 上做版本基线检查、lint、单测、前端构建，再在 Windows（MSVC、Rust 1.99.1、Node 24 LTS、pnpm 12、WiX 7）上编译 `Primus.exe`。Windows 作业依赖 Linux 检查通过后才启动；`pnpm check:forbidden-sdk` 检查依赖图与导入图中的被禁 SDK（规则在 `scripts/forbidden-sdk.json`，第 6.2 节）。
- Renovate（`renovate.json`）：每月 1 日把纳入 Renovate 的稳定版升级合成一个 PR 提到 `dev`，锁定精确版本；`agent-core/` 不在升级范围内（随上游版本手动同步）；需要在 GitHub 上为本仓库安装 Renovate 应用。

MSI 打包流程见 `scripts/build-msi.ps1` 与技术方案第 3.3 节。

## 路线图

| 阶段 | 周期 | 内容 | 验收 |
|---|---|---|---|
| P0 打通 | 第 1–4 周 | 工程骨架、Core 引入与构建、RPC 进程监管、单会话对话、数据目录、MSI 可安装 | 干净 Windows 11 上 MSI 安装并完成一次真实对话，数据全部在 `<安装目录>\data` |
| P1 核心 | 第 5–12 周 | 多会话与索引、工具卡片、确认框、模型配置与 Vault、上下文与压缩、primus-guard、primus-context、检查点回滚、变更视图、设置、Shell 检测 | 10 个真实项目试用；危险操作都会触发确认 |
| P2 完善 | 第 13–18 周 | 子 Agent、计划模式与待办、能力中心、会话树、用量统计、自动更新、诊断包、性能达标 | 内部发布 1.0（Windows） |
| P3 跨平台 | 第 19–24 周 | macOS、Linux 打包与适配 | 三平台发布 |

## 许可

作者保留所有权力。
