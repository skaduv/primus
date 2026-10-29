# 0003 RPC 契约测试的 Faux provider 用本机脚本化模型服务实现

- 状态：已接受
- 日期：2026-10-29

## 背景
技术方案第 23 章要求 RPC 契约测试用“Node 脚本 + 真实 Core 构建产物 + Faux provider”。Core 自带的 Faux provider 只能在进程内注册：需要一个扩展从 Core 的上游包名导入它，再调用 `registerProvider`。这与两条规则冲突：

- `agent-core/` 之外不得出现上游项目的原始名称（AGENTS.md 第 2.2 节），测试扩展的导入语句就会出现；
- 不应为了测试改 Core 源码（第 2.3 节只允许品牌、两协议裁剪、构建入口三类改动），给 Core 加一个乾元命名的别名不属于这三类。

## 决策
- Faux provider 实现为契约测试进程里的本机 HTTP 服务（`scripts/core-contract/faux-model.mjs`），只监听 `127.0.0.1` 的随机端口，按 `anthropic-messages` 协议（两协议之一）以 SSE 返回脚本化的回复；可设置增量之间的延迟，用于中止用例；记录收到的请求以及请求是否被 Core 中途断开。
- Core 通过临时配置目录里的 `models.json` 访问它：供应商 `faux`、模型 `faux-1`、`api: anthropic-messages`，启动参数 `--offline --provider faux --model faux-1`。
- 契约测试进程给 Core 设置 `NO_PROXY=127.0.0.1,localhost`，避免开发机或 CI 的代理拦截本机请求。

## 后果
- Core 走真实的供应商适配器、鉴权、流式解析、重试与取消路径，契约覆盖比进程内 Faux 更完整；协议仍只有两种，不引入新依赖，也不改 `agent-core/`。
- 脚本化回复只覆盖文本；工具调用、思考块等后续用例需要时在 `sseEvents()` 中扩展对应的 SSE 事件。
- E2E（第 23 章）需要 Faux provider 时可复用同一个服务。
- 若以后 Core 提供不经上游包名即可使用的 Faux 注册方式，可再评估切换。
