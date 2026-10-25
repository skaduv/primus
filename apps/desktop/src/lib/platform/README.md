# lib/platform

平台接口层（技术方案第 16.1.1 节、附录 B）。**只有 `tauri/` 目录允许 import `@tauri-apps/*` 或访问 Tauri 注入的全局对象**，其他代码只依赖本目录 `index.ts` 导出的接口。CI 用 `pnpm check:tauri-imports`（`scripts/check-tauri-imports.mjs`）检查。

- `types.ts`：`Platform` 接口（每个方法对应一条薄壳命令）与 `COMMANDS` 映射表。
- `index.ts`：`getPlatform()` 按运行环境动态加载实现：Tauri 窗口内用 `tauri/`，浏览器（`pnpm dev:web`）里用 `mock/`。
- `tauri/`：真实实现，逐个 `invoke` 薄壳命令；会话事件与终端输出走 `Channel`。
- `mock/`：浏览器预览实现。`scenario.ts` 按 Core JSON 事件流规范生成一轮完整运行（思考、流式文本、工具调用与结果、第二轮回答、`agent_settled`），按 16ms 一批推送；支持 `prompt`、`abort`、`get_state`、`get_messages`。

新增薄壳命令时：在 `types.ts` 加方法和 `COMMANDS` 条目，同时补 `tauri/` 与 `mock/` 实现（两边的单测会检查方法是否齐全）。
