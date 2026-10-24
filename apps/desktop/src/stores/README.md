# stores

zustand 5 状态（第 16.4 节）。

- `app-store.ts`：全局 store —— 工作区、设置、会话索引。
- `session-store.ts`：每个打开的会话一个独立 store，事件按 `seq` 合并；关闭即释放，重开时用 `get_messages` 重建。

性能规则：每批事件只 `setState` 一次（放在 `requestAnimationFrame` 中）；组件用 selector 订阅最小切片；已定稿消息不再更新。
