# Agent Core 改动登记（PATCHES）

本目录是上游开源 Agent 内核的完整源码，通过 `git subtree` 引入，保留上游 `LICENSE`（MIT）与版权声明。
乾元（Primus）对本目录的**每一处**改动都登记在这里，以便升级时逐条重新应用（技术方案第 6.1–6.3 节）。

## 当前上游版本

| 项目 | 值 |
|------|----|
| 上游仓库 | https://github.com/earendil-works/pi |
| 发布标签 | `v1.4.0`（2026-10-21 发布，最新稳定版） |
| 上游提交 | `4a080252f06caf63a525d7873c5d94d3c23887e0` |
| 引入方式 | `git subtree add --prefix=agent-core <上游仓库> v1.4.0 --squash` |
| 引入日期 | 2026-10-24 |
| 依赖锁定 | `package-lock.json`（上游自带，未改动） |
| 模型目录 | `nix/model-catalog.json` 锁定的修订版（SHA-256 校验），由 `scripts/build-core.mjs` 下载后离线生成 |

## 升级流程

```bash
git subtree pull --prefix=agent-core https://github.com/earendil-works/pi.git <新标签> --squash
# 按下方登记逐条重新应用改动 → 更新本文件“当前上游版本”
pnpm build:core && pnpm smoke:core   # 构建 + RPC 冒烟
# 再跑 RPC 协议回归、会话格式兼容、第一方扩展 API 检查、裁剪依赖检查（第 6.1 节）
```

## 改动登记

允许的改动只有三类：**品牌**、**两协议裁剪**、**构建入口**（AGENTS.md）。每条写明：改了什么、为什么、涉及文件。

| 编号 | 类别 | 改动 | 原因 | 涉及文件 | 状态 |
|------|------|------|------|----------|------|
| — | — | 暂无源码改动，`agent-core/` 与上游 `v1.4.0` 完全一致（本文件除外） | — | — | — |

### 计划中的改动（尚未实施）

- **品牌**（第 6.3 节）：`packages/coding-agent/package.json` 配置名称 `primus`、配置目录 `.primus`；硬编码环境变量前缀改为 `PRIMUS_`；系统提示产品名改为“乾元（Primus）”；进程标题、`AI_AGENT` 改为 `primus`；关闭版本检查、分享、安装器等联网入口。
- **两协议裁剪**（第 6.2 节）：`packages/ai` 只保留 OpenAI Responses 与 Anthropic Messages 适配器，删除其余供应商的导入与 SDK 依赖并更新锁文件。同步处理上游开发工具目录中与两协议约束不符的指导（如“新增 LLM 供应商”技能说明），届时裁剪或改写并在上表登记。
- **构建入口**：如需调整 `rpc-entry` 打包配置，在此登记。

## 本仓库侧的构建约定（不改动本目录源码）

- `scripts/build-core.mjs`：`npm ci`（设置 `HUSKY=0`，避免上游 `prepare` 脚本改写本仓库 git hooks）→ 下载并校验锁定的模型目录 → `hydrate-model-catalog.ts` 离线生成模型数据 → `npm run build:offline`。不使用上游默认的 `npm run build`，因为它会在线抓取最新模型数据，结果不可复现。
- `scripts/smoke-core-rpc.mjs`：以临时目录作为 HOME，`--offline` 启动 `packages/coding-agent/dist/bundle/rpc-entry.js`，发送 `get_state`，校验收到成功的 `response`。
