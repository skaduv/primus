// 前端 → Core：RPC 命令（rpc-commands.md）。每条命令是一行 JSON，经 core_send 写入 stdin。
// `id` 可选，Core 在对应 response 里原样带回；本项目由前端生成 `<sessionKey>-<自增序号>`（第 7.2 节）。

import type { ImageContent, ThinkingLevel } from "./content.ts";

interface CommandBase {
  id?: string;
}

/** 队列投递方式：`all` 一次全部投递；`one-at-a-time` 每次一条（Core 默认） */
export type QueueMode = "all" | "one-at-a-time";

// ---------- 发送 ----------

/**
 * 发送用户输入。Agent 正在运行时必须指定 `streamingBehavior`，否则返回错误；
 * 扩展命令（如 `/primus-plan on`）即使在运行中也会立即执行。
 */
export interface PromptCommand extends CommandBase {
  type: "prompt";
  message: string;
  images?: ImageContent[];
  /** `steer`：当前轮工具调用结束后、下一次模型调用前投递；`followUp`：Agent 停下后投递 */
  streamingBehavior?: "steer" | "followUp";
}

export interface SteerCommand extends CommandBase {
  type: "steer";
  message: string;
  images?: ImageContent[];
}

export interface FollowUpCommand extends CommandBase {
  type: "follow_up";
  message: string;
  images?: ImageContent[];
}

/** 中止当前操作，等会话空闲后才响应 */
export interface AbortCommand extends CommandBase {
  type: "abort";
}

/** 清空排队的 steer / follow_up，返回其文本（Esc：先 clear_queue 再 abort） */
export interface ClearQueueCommand extends CommandBase {
  type: "clear_queue";
}

export interface NewSessionCommand extends CommandBase {
  type: "new_session";
  /** 父会话文件路径 */
  parentSession?: string;
}

// ---------- 状态 ----------

export interface GetStateCommand extends CommandBase {
  type: "get_state";
}

export interface GetMessagesCommand extends CommandBase {
  type: "get_messages";
}

// ---------- 模型 ----------

export interface SetModelCommand extends CommandBase {
  type: "set_model";
  provider: string;
  modelId: string;
}

export interface CycleModelCommand extends CommandBase {
  type: "cycle_model";
}

export interface GetAvailableModelsCommand extends CommandBase {
  type: "get_available_models";
}

// ---------- 思考强度 ----------

export interface SetThinkingLevelCommand extends CommandBase {
  type: "set_thinking_level";
  level: ThinkingLevel;
}

export interface CycleThinkingLevelCommand extends CommandBase {
  type: "cycle_thinking_level";
}

export interface GetAvailableThinkingLevelsCommand extends CommandBase {
  type: "get_available_thinking_levels";
}

// ---------- 队列模式 ----------

export interface SetSteeringModeCommand extends CommandBase {
  type: "set_steering_mode";
  mode: QueueMode;
}

export interface SetFollowUpModeCommand extends CommandBase {
  type: "set_follow_up_mode";
  mode: QueueMode;
}

// ---------- 压缩 ----------

export interface CompactCommand extends CommandBase {
  type: "compact";
  /** 「重点保留什么」 */
  customInstructions?: string;
}

export interface SetAutoCompactionCommand extends CommandBase {
  type: "set_auto_compaction";
  enabled: boolean;
}

// ---------- 重试 ----------

export interface SetAutoRetryCommand extends CommandBase {
  type: "set_auto_retry";
  enabled: boolean;
}

export interface AbortRetryCommand extends CommandBase {
  type: "abort_retry";
}

// ---------- 用户命令（! 命令） ----------

/** 执行 shell 命令；带 `id` 时输出以带同一 id 的 bash_execution_update 事件流式到达 */
export interface BashCommand extends CommandBase {
  type: "bash";
  command: string;
  /** 存入会话但下次 prompt 时不进入模型上下文（!! 命令） */
  excludeFromContext?: boolean;
}

export interface AbortBashCommand extends CommandBase {
  type: "abort_bash";
}

// ---------- 会话 ----------

export interface GetSessionStatsCommand extends CommandBase {
  type: "get_session_stats";
}

export interface ExportHtmlCommand extends CommandBase {
  type: "export_html";
  outputPath?: string;
}

export interface SwitchSessionCommand extends CommandBase {
  type: "switch_session";
  sessionPath: string;
}

/** 从当前分支上的一条用户消息分叉 */
export interface ForkCommand extends CommandBase {
  type: "fork";
  entryId: string;
}

/** 把当前分支复制成新会话 */
export interface CloneCommand extends CommandBase {
  type: "clone";
}

export interface GetForkMessagesCommand extends CommandBase {
  type: "get_fork_messages";
}

/** 按追加顺序取条目；`since` 为游标，只返回该条目之后的条目（不存在时返回失败） */
export interface GetEntriesCommand extends CommandBase {
  type: "get_entries";
  since?: string;
}

export interface GetTreeCommand extends CommandBase {
  type: "get_tree";
}

export interface GetLastAssistantTextCommand extends CommandBase {
  type: "get_last_assistant_text";
}

export interface SetSessionNameCommand extends CommandBase {
  type: "set_session_name";
  name: string;
}

// ---------- 斜杠命令 ----------

/** 列出扩展命令、提示模板与技能（以 `/名称` 经 prompt 调用） */
export interface GetCommandsCommand extends CommandBase {
  type: "get_commands";
}

export type RpcCommand =
  | PromptCommand
  | SteerCommand
  | FollowUpCommand
  | AbortCommand
  | ClearQueueCommand
  | NewSessionCommand
  | GetStateCommand
  | GetMessagesCommand
  | SetModelCommand
  | CycleModelCommand
  | GetAvailableModelsCommand
  | SetThinkingLevelCommand
  | CycleThinkingLevelCommand
  | GetAvailableThinkingLevelsCommand
  | SetSteeringModeCommand
  | SetFollowUpModeCommand
  | CompactCommand
  | SetAutoCompactionCommand
  | SetAutoRetryCommand
  | AbortRetryCommand
  | BashCommand
  | AbortBashCommand
  | GetSessionStatsCommand
  | ExportHtmlCommand
  | SwitchSessionCommand
  | ForkCommand
  | CloneCommand
  | GetForkMessagesCommand
  | GetEntriesCommand
  | GetTreeCommand
  | GetLastAssistantTextCommand
  | SetSessionNameCommand
  | GetCommandsCommand;

export type RpcCommandType = RpcCommand["type"];

/** 某类命令的记录 */
export type RpcCommandOf<T extends RpcCommandType> = Extract<RpcCommand, { type: T }>;

/** 某类命令除 `type`、`id` 外的参数 */
export type RpcCommandParams<T extends RpcCommandType> = Omit<RpcCommandOf<T>, "type" | "id">;

export const RPC_COMMAND_TYPES = [
  "prompt",
  "steer",
  "follow_up",
  "abort",
  "clear_queue",
  "new_session",
  "get_state",
  "get_messages",
  "set_model",
  "cycle_model",
  "get_available_models",
  "set_thinking_level",
  "cycle_thinking_level",
  "get_available_thinking_levels",
  "set_steering_mode",
  "set_follow_up_mode",
  "compact",
  "set_auto_compaction",
  "set_auto_retry",
  "abort_retry",
  "bash",
  "abort_bash",
  "get_session_stats",
  "export_html",
  "switch_session",
  "fork",
  "clone",
  "get_fork_messages",
  "get_entries",
  "get_tree",
  "get_last_assistant_text",
  "set_session_name",
  "get_commands",
] as const satisfies readonly RpcCommandType[];
