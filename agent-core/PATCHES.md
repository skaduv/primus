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
| 依赖锁定 | `package-lock.json`：两协议裁剪后重新生成（见登记 P-02） |
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
| P-01 | 两协议裁剪 | 删除除 `openai-responses`、`anthropic-messages` 以外的 33 个 API 适配器（含 `.lazy.ts` 懒加载壳与 Google/Bedrock/Mistral/Cloudflare/Codex/Chat Completions 等共享模块）及约 40 个内置供应商（含各自 `*.models.ts`）；OAuth 只保留 `anthropic` 与 `openai-chatgpt`。`types.ts`（`KnownApi`/`KnownProvider`）、`compat.ts`、`index.ts` 导出、`legacy-api-aliases.ts`、`providers/all.ts`、`auth/oauth/load.ts`、`bun-oauth.ts`、`images.ts` 同步 | 产品只支持两种协议（技术方案第 6.2 节），其余代码与 SDK 不得进入 Core | `packages/ai/src/api/*`、`packages/ai/src/providers/*`、`packages/ai/src/auth/oauth/*`、`packages/ai/src/{types,compat,index,legacy-api-aliases,images,bun-oauth}.ts` | 已实施 |
| P-02 | 两协议裁剪 | 删除依赖 `@google/genai`、`@aws-sdk/client-bedrock-runtime`、`@smithy/node-http-handler` 与 `./bedrock-provider` 导出；`package-lock.json` 重新生成，移除 39 个包 | 被裁剪供应商的 SDK 不得出现在依赖树与产物中（`scripts/forbidden-sdk.json` 的 `enforceCore`） | `packages/ai/package.json`、`packages/ai/src/bedrock-provider.ts`（删）、`package-lock.json` | 已实施 |
| P-03 | 两协议裁剪 | `generate-models.ts` 只生成 `anthropic`、`openai` 两家模型数据；`hydrate-model-catalog.ts` 按供应商白名单过滤，白名单内供应商为空时报错退出 | 内置模型目录只含两协议供应商，且离线生成可复现 | `packages/ai/scripts/generate-models.ts`、`packages/ai/scripts/hydrate-model-catalog.ts`、`packages/ai/src/models.generated.ts`、`packages/ai/src/providers/{anthropic,openai}.models.ts` | 已实施 |
| P-04 | 构建入口 | `build-coding-agent-bundle.mjs` 去掉 Bedrock 打包锚点与已删 OAuth 模块的懒加载入口 | 已删模块不再存在，打包配置须同步 | `scripts/build-coding-agent-bundle.mjs` | 已实施 |
| P-05 | 两协议裁剪 | 删除内置 llama.cpp 扩展（本地模型下载与分类器） | 依赖已删的 Chat Completions/分类器适配器，且会联网下载模型 | `packages/coding-agent/src/extensions/llama/*`（删）、`packages/coding-agent/src/extensions/index.ts` | 已实施 |
| P-06 | 两协议裁剪 | `model-runtime` 不再拉取远程模型目录、不做 OpenRouter 个性化、不注册 Radius 网关供应商；`model-resolver` 去掉已删供应商的缺省模型 | 只用离线内置目录与用户自配供应商，不联网到第三方目录 | `packages/coding-agent/src/core/model-runtime.ts`、`packages/coding-agent/src/core/radius.ts`、`packages/coding-agent/src/core/model-resolver.ts` | 已实施 |
| P-07 | 品牌 | 包配置 `piConfig` 名称 `primus`、配置目录 `.primus`；`config.ts` 缺省值同步；`APP_TITLE` 为“乾元（Primus）” | 产品名与用户数据目录（技术方案第 6.3 节） | `packages/coding-agent/package.json`、`packages/coding-agent/src/config.ts` | 已实施 |
| P-08 | 品牌 | 环境变量前缀 `PI_` → `PRIMUS_`（如 `PRIMUS_OFFLINE`、`PRIMUS_TELEMETRY`、`PRIMUS_CODING_AGENT_DIR`）；保留源码常量名 `PI_AI_VERSION`、`PI_BUNDLED_NODE`、`PI_ATTRIBUTION`（只是标识符，不是环境变量） | 用户可见配置统一品牌，降低升级合并冲突 | `packages/coding-agent/src/**`、`packages/tui/src/{terminal,terminal-image,tui-main-screen}.ts`、`packages/coding-agent/vitest.config.ts`、`test.sh` | 已实施 |
| P-09 | 品牌 | 系统提示身份改为“乾元（Primus）”，删除上游文档指引段（`docs` 段）；`AI_AGENT`、进程标题、`User-Agent` 产品标识为 `primus`；去掉发往供应商的归因头（`attribution` 为 `null`） | 产品身份；不向第三方宣传上游项目 | `packages/coding-agent/src/core/system-prompt.ts`、`packages/coding-agent/src/core/client-identity.ts`、`packages/ai/src/utils/identity.ts`、`packages/coding-agent/src/main.ts`、`packages/coding-agent/src/rpc-entry.ts` | 已实施 |
| P-10 | 品牌 | bash 与 PowerShell 工具说明、bug report 文案、`vitest.config.ts`、`scripts/` 下 `coding-agent-smoke.mjs`/`profile-coding-agent-node.mjs`/`smoke-test-codemode-binary.mjs`、`test.sh`、`packages/coding-agent/docs/*` 中的产品名、命令名、目录与环境变量改名；CLI 帮助中 `update` 文案改为 Primus 并注明自更新已禁用，删除 `/share` 地址环境变量说明 | 用户可见文本统一品牌 | `packages/coding-agent/src/core/tools/{bash,powershell}.ts`、`packages/coding-agent/src/cli/args.ts`、`packages/coding-agent/src/package-manager-cli.ts`、`scripts/*.mjs`、`test.sh`、`packages/coding-agent/docs/*.md` | 已实施 |
| P-11 | 品牌 | 关闭联网入口：版本检查固定返回空结果；自更新与安装器调用抛错（Core 随桌面端一起更新）；安装上报改为空函数；`/share` 与 bug report 上传禁用 | 不得向上游服务发送任何数据；更新由桌面端统一负责 | `packages/coding-agent/src/utils/version-check.ts`、`packages/coding-agent/src/package-manager-cli.ts`、`packages/coding-agent/src/core/{package-manager,telemetry,bug-report-upload,bug-report}.ts`、`packages/coding-agent/src/modes/interactive/{session-share,bug-report,interactive-mode}.ts`、`packages/coding-agent/src/utils/tools-manager.ts` | 已实施 |
| P-12 | 两协议裁剪 | 开发指导：删除 `.pi/skills/add-llm-provider.md`；改写 `packages/ai/README.md`、`CONTRIBUTING.md`、`AGENTS.md`，说明只支持两协议、不接受新增供应商 | 避免开发工具按上游指导重新引入供应商 | `.pi/skills/add-llm-provider.md`（删）、`packages/ai/README.md`、`CONTRIBUTING.md`、`AGENTS.md` | 已实施 |
| P-13 | 两协议裁剪 | 测试：删除只覆盖已删适配器/供应商/OAuth/llama/Radius 的测试（`packages/ai/test` 111 个文件、`packages/coding-agent/test` 5 个、`packages/durable/test` 1 个），以及实网 e2e 多供应商矩阵；其余测试断言跟上改名（`.primus`、`PRIMUS_`、`primus` 会话头、归因为 `null`、系统提示无 `docs` 段等）；新增 `packages/ai/test/generate-models-providers.test.ts` 校验模型生成只含两家 | 测试与裁剪后的代码一致 | `packages/*/test/**` | 已实施 |

### 已知遗留

- `packages/coding-agent/src/core/remote-catalog-provider.ts`：源码保留，生产代码已不引用，但仍被测试文件 `packages/coding-agent/test/remote-catalog-provider.test.ts` 导入（P-06）；删除该源码前须同时处理此测试。
- `packages/ai/src/providers/radius-config.ts`：源码保留，且仍被 `packages/coding-agent/src/core/radius.ts` 引用（导入网关地址常量 `DEFAULT_RADIUS_GATEWAY` 与 `normalizeRadiusGatewayUrl`，供交互界面登录提示与已禁用的 bug report 上传文案使用），升级时不可删除；Radius 供应商本身已不注册，不会发出请求（P-06）。两者保留都是为了减少与上游的合并冲突。
- `packages/coding-agent/src/extensions/mcp/oauth.ts` 的 CIMD（客户端元数据文档）地址仍指向上游，仅当 MCP 服务器配置 `clientRegistration: "cimd"` 时才会使用。
- `packages/coding-agent/src/config.ts` 的 `DEFAULT_SHARE_VIEWER_URL` 与 `packages/ai/src/utils/identity.ts` 的 `PI_ATTRIBUTION` 字符串仍在源码中，但不再被调用（P-09、P-11）。
- `packages/ai/src/providers/compat-schema.ts` 仍包含其他协议的兼容键（只是配置结构定义，不引入 SDK）。
- 实网 e2e 多供应商矩阵已移除，两协议的实网验证待后续按需补充。

## 本仓库侧的构建约定（不改动本目录源码）

- `scripts/build-core.mjs`：`npm ci`（设置 `HUSKY=0`，避免上游 `prepare` 脚本改写本仓库 git hooks）→ 下载并校验锁定的模型目录 → `hydrate-model-catalog.ts` 离线生成模型数据 → 编译前清空各包 `dist/`（tsc 不会删除已删源文件的旧产物，残留的裁剪适配器会进入产物并让被禁 SDK 检查误报）→ `npm run build:offline`。不使用上游默认的 `npm run build`，因为它会在线抓取最新模型数据，结果不可复现。
- `scripts/smoke-core-rpc.mjs`：以临时目录作为 HOME，`--offline` 启动 `packages/coding-agent/dist/bundle/rpc-entry.js`，发送 `get_state`，校验收到成功的 `response`。
