# lib/platform

平台接口层。**只有 `tauri/` 目录允许 import `@tauri-apps/*`**，其他代码只依赖 `index.ts` 导出的接口。CI 用 `scripts/check-tauri-imports.mjs` 检查。

- `index.ts`：平台接口定义（对应附录 B 薄壳命令）。
- `tauri/`：真实实现，调用 `invoke` / Channel。
- `mock/`：`next dev` 浏览器预览用，脚本化的假 Core 事件流。
