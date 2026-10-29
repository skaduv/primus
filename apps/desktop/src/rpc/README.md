# rpc

前端 RPC 客户端（技术方案第 7 章），一个会话一个 `RpcClient` 实例，不依赖 React。

- `rpc-client.ts`
  - 命令 id：`<sessionKey>-<自增序号>`；`request(type, params)` 按 id 关联 response（不依赖顺序），参数按 `@primus/protocol` 的命令类型约束。
  - 超时：10 秒没有 response 抛 `RpcTimeoutError` 并回调 `onUnresponsive`（界面显示“内核无响应”与“重启内核”）；任一超时命令的 response 迟到时回调 `onResponsive`（其余超时命令的 response 可能随丢弃的批次丢失，不再等待）。`bash`、`compact` 不计超时。
  - `seq` 缺口：批次重复或过期时忽略；序号不连续或 `dropped > 0` 时自动发 `get_messages` + `get_state` 重建，重建中再遇缺口则结束后再来一轮；`resync()` 返回是否成功，重启后重建失败时界面保持“内核无响应”。
  - `respondUi()` 回复扩展 UI 对话框；`reset()` 用于内核重启后结束等待中的命令；`close()` 关闭会话。
- 流式消息重建（delta 追加 → `*_end` 替换 → `message_end` 定稿 → `agent_settled` 解锁输入）与重建结果的应用在 `src/stores/session-store.ts`（`applyChunks`）。
- 组合方式见 `src/features/chat/use-chat-session.ts`：批次 → `RpcClient.receive` → 去重后的记录在 `requestAnimationFrame` 中合并进会话 store。
