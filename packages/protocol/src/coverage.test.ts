// 与锁定版本 Core 的导出类型与 RPC 实现逐项对照（开发计划第 3 周第 4 项验收）。
// 从 agent-core/ 的源码提取命令、事件、扩展 UI 方法、消息角色、会话条目的名称，
// 与本包导出的清单做集合比较：Core 升级后多出或少了任何一项，这里都会失败。
// agent-core/ 不再携带上游文档（docs/ 已裁剪），只以源码为准。
// 字段类型由 contract.typecheck.ts 用文档示例做编译期校验。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_MESSAGE_ROLES,
  ASSISTANT_MESSAGE_EVENT_TYPES,
  EXTENSION_UI_DIALOG_METHODS,
  EXTENSION_UI_METHODS,
  RPC_COMMAND_TYPES,
  SESSION_ENTRY_TYPES,
  SESSION_EVENT_TYPES,
} from "./index.ts";

const CORE = new URL("../../../agent-core/packages/", import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, CORE)), "utf8");

const src = {
  rpcTypes: read("coding-agent/src/modes/rpc/rpc-types.ts"),
  rpcMode: read("coding-agent/src/modes/rpc/rpc-mode.ts"),
  messages: read("coding-agent/src/core/messages.ts"),
  agentSession: read("coding-agent/src/core/agent-session.ts"),
  agentTypes: read("agent/src/types.ts"),
  aiTypes: read("ai/src/types.ts"),
  sessionManager: read("coding-agent/src/core/session-manager.ts"),
};

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const matches = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1] as string);

/** 取一个 TS 类型声明（到下一个顶层 export / 空行分隔的声明为止） */
function typeBlock(text: string, start: string): string {
  const from = text.indexOf(start);
  expect(from, `找不到「${start}」`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(from + start.length);
  const end = rest.search(/\n(export |\/\*\*|\/\/ =+)/);
  return rest.slice(0, end < 0 ? undefined : end);
}

describe("RPC 命令", () => {
  it("与 Core 导出的 RpcCommand 联合一致", () => {
    const union = typeBlock(src.rpcTypes, "export type RpcCommand =");
    expect(sorted(RPC_COMMAND_TYPES)).toEqual(sorted(matches(union, /type: "([a-z_]+)"/g)));
  });

  it("每条命令在 RpcResponse 联合中都有成功响应", () => {
    const union = typeBlock(src.rpcTypes, "export type RpcResponse =");
    expect(sorted(RPC_COMMAND_TYPES)).toEqual(sorted(matches(union, /command: "([a-z_]+)"/g)));
  });

  it("与 rpc-mode.ts 实际处理的命令一致", () => {
    const handled = matches(src.rpcMode, /^\t\t\tcase "([a-z_]+)": \{/gm);
    expect(sorted(RPC_COMMAND_TYPES)).toEqual(sorted(handled));
  });
});

describe("会话事件", () => {
  it("与 Core 的 AgentSessionEvent / AgentEvent 联合一致", () => {
    const sessionUnion = typeBlock(src.agentSession, "export type AgentSessionEvent =");
    const agentUnion = typeBlock(src.agentTypes, "export type AgentEvent =");
    const names = [
      ...matches(sessionUnion, /type: "([a-z_]+)"/g),
      ...matches(agentUnion, /type: "([a-z_]+)"/g),
    ];
    expect(sorted(SESSION_EVENT_TYPES)).toEqual(sorted(names));
  });

  it("RPC 独有的 extension_error 由 rpc-mode.ts 发出", () => {
    expect(src.rpcMode).toContain('type: "extension_error"');
  });

  it("message_update 的增量事件与 AssistantMessageEvent 一致", () => {
    const union = typeBlock(src.aiTypes, "export type AssistantMessageEvent =");
    expect(sorted(ASSISTANT_MESSAGE_EVENT_TYPES)).toEqual(
      sorted(matches(union, /type: "([a-z_]+)"/g)),
    );
  });
});

describe("扩展 UI", () => {
  it("请求方法与 RpcExtensionUIRequest 一致", () => {
    const union = typeBlock(src.rpcTypes, "export type RpcExtensionUIRequest =");
    expect(sorted(EXTENSION_UI_METHODS)).toEqual(sorted(matches(union, /method: "([A-Za-z_]+)"/g)));
  });

  it("对话框方法与 rpc-mode.ts 中等待响应的请求一致", () => {
    // 扩展 UI 上下文里每个方法一段；登记了待回复请求（直接或经 createDialogPromise）的是对话框
    const start = src.rpcMode.indexOf("const createExtensionUIContext");
    expect(start, "找不到 createExtensionUIContext").toBeGreaterThanOrEqual(0);
    const chunks = src.rpcMode.slice(start).split(/\n\t\t(?=(?:async )?[A-Za-z_]+[(:])/);
    const dialogs = chunks
      .filter(
        (c) => c.includes("createDialogPromise(") || c.includes("pendingExtensionRequests.set"),
      )
      .flatMap((c) => matches(c, /method: "([A-Za-z_]+)"/g));
    expect(sorted(EXTENSION_UI_DIALOG_METHODS)).toEqual(sorted(dialogs));
  });

  it("响应形状与 RpcExtensionUIResponse 一致（value / confirmed / cancelled）", () => {
    const union = typeBlock(src.rpcTypes, "export type RpcExtensionUIResponse =");
    expect(sorted(matches(union, /id: string; ([a-z]+):/g))).toEqual([
      "cancelled",
      "confirmed",
      "value",
    ]);
  });
});

describe("消息与会话条目", () => {
  it("消息角色与 Core 的 Message 及 coding-agent 自定义消息一致", () => {
    const roles = [
      ...matches(src.aiTypes, /^\t+role: "([A-Za-z]+)";$/gm),
      ...matches(src.messages, /^\t+role: "([A-Za-z]+)";$/gm),
    ];
    expect(sorted(AGENT_MESSAGE_ROLES)).toEqual(sorted(roles));
  });

  it("会话条目类型与 SessionEntry 联合一致", () => {
    const entryTypes = matches(
      src.sessionManager,
      /^export interface \w+Entry(?:<T = unknown>)? extends SessionEntryBase \{\n\ttype: "([a-z_]+)";/gm,
    );
    expect(sorted(SESSION_ENTRY_TYPES)).toEqual(sorted(entryTypes));
  });
});
