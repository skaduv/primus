# rpc

前端 RPC 客户端（第 7 章）：命令 id 生成、`response` 关联、10 秒超时、`seq` 缺口检测（缺口时用 `get_messages` 重建）、流式消息重建（delta 追加 → `*_end` 替换 → `message_end` 定稿 → `agent_settled` 解锁输入）。
