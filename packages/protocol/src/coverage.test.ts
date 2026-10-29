// 与锁定版本 Core 的 RPC 文档、导出类型逐项对照（开发计划第 3 周第 4 项验收）。
// 从 agent-core/ 中的文档与源码提取命令、事件、扩展 UI 方法、消息角色、会话条目的名称，
// 与本包导出的清单做集合比较：Core 升级后多出或少了任何一项，这里都会失败。
// 字段级对照见 README.md；字段类型由 contract.typecheck.ts 用文档示例做编译期校验。

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

const docs = {
  commands: read("coding-agent/docs/rpc-commands.md"),
  events: read("coding-agent/docs/json.md"),
  extensionUi: read("coding-agent/docs/rpc-extension-ui.md"),
  messages: read("coding-agent/docs/message-types.md"),
  session: read("coding-agent/docs/session-format.md"),
};
const src = {
  rpcTypes: read("coding-agent/src/modes/rpc/rpc-types.ts"),
  rpcMode: read("coding-agent/src/modes/rpc/rpc-mode.ts"),
  agentSession: read("coding-agent/src/core/agent-session.ts"),
  agentTypes: read("agent/src/types.ts"),
  aiTypes: read("ai/src/types.ts"),
  sessionManager: read("coding-agent/src/core/session-manager.ts"),
};

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const matches = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1] as string);

/** 取两个标题之间的正文 */
function section(text: string, start: string, end?: string): string {
  const from = text.indexOf(start);
  expect(from, `找不到「${start}」`).toBeGreaterThanOrEqual(0);
  const to = end ? text.indexOf(end, from + start.length) : -1;
  return text.slice(from, to < 0 ? undefined : to);
}

/** 取一个 TS 类型声明（到下一个顶层 export / 空行分隔的声明为止） */
function typeBlock(text: string, start: string): string {
  const from = text.indexOf(start);
  expect(from, `找不到「${start}」`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(from + start.length);
  const end = rest.search(/\n(export |\/\*\*|\/\/ =+)/);
  return rest.slice(0, end < 0 ? undefined : end);
}

/** Markdown 表格首列中的反引号名称 */
const tableNames = (text: string) => matches(text, /^\|\s*`([a-z_]+)`\s*\|/gm);

describe("RPC 命令", () => {
  it("与 rpc-commands.md 的命令章节一致", () => {
    const body = section(docs.commands, "## Prompting", "## Model object");
    expect(sorted(RPC_COMMAND_TYPES)).toEqual(sorted(matches(body, /^### ([a-z_]+)$/gm)));
  });

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
  it("与 json.md 的事件表与示例一致", () => {
    const body = section(docs.events, "## Agent and turn events", "## TypeScript types");
    const nested = section(docs.events, "The nested event is one of", "The normal agent loop");
    const nestedNames = new Set(tableNames(nested));
    const tabled = tableNames(body).filter((name) => !nestedNames.has(name));
    // 不在表格中的事件只出现在 JSON 示例里：取每个示例对象的顶层 type
    const examples = matches(body, /^\s*\{?\s*"type":\s*"([a-z_]+)"/gm);
    const documented = new Set([...tabled, ...examples]);
    documented.delete("extension_error"); // RPC 独有，单独核对
    expect(sorted(SESSION_EVENT_TYPES)).toEqual(sorted(documented));
  });

  it("与 Core 的 AgentSessionEvent / AgentEvent 联合一致", () => {
    const sessionUnion = typeBlock(src.agentSession, "export type AgentSessionEvent =");
    const agentUnion = typeBlock(src.agentTypes, "export type AgentEvent =");
    const names = [
      ...matches(sessionUnion, /type: "([a-z_]+)"/g),
      ...matches(agentUnion, /type: "([a-z_]+)"/g),
    ];
    expect(sorted(SESSION_EVENT_TYPES)).toEqual(sorted(names));
  });

  it("RPC 独有的 extension_error 在文档与 rpc-mode.ts 中都存在", () => {
    expect(docs.events).toContain('"type":"extension_error"');
    expect(src.rpcMode).toContain('type: "extension_error"');
  });

  it("message_update 的增量事件与 json.md、AssistantMessageEvent 一致", () => {
    const nested = section(docs.events, "The nested event is one of", "The normal agent loop");
    expect(sorted(ASSISTANT_MESSAGE_EVENT_TYPES)).toEqual(sorted(tableNames(nested)));
    const union = typeBlock(src.aiTypes, "export type AssistantMessageEvent =");
    expect(sorted(ASSISTANT_MESSAGE_EVENT_TYPES)).toEqual(
      sorted(matches(union, /type: "([a-z_]+)"/g)),
    );
  });
});

describe("扩展 UI", () => {
  it("请求方法与 rpc-extension-ui.md 及 RpcExtensionUIRequest 一致", () => {
    const body = section(docs.extensionUi, "## Requests from", "## Responses to");
    expect(sorted(EXTENSION_UI_METHODS)).toEqual(sorted(matches(body, /^### ([A-Za-z_]+)$/gm)));
    const union = typeBlock(src.rpcTypes, "export type RpcExtensionUIRequest =");
    expect(sorted(EXTENSION_UI_METHODS)).toEqual(sorted(matches(union, /method: "([A-Za-z_]+)"/g)));
  });

  it("对话框方法与文档一致", () => {
    const intro = section(docs.extensionUi, "**Dialog methods**", "**Fire-and-forget methods**");
    const listed = intro.match(/\(([^)]*)\)/)?.[1] ?? "";
    expect(sorted(EXTENSION_UI_DIALOG_METHODS)).toEqual(sorted(matches(listed, /`([a-z]+)`/g)));
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
  it("消息角色与 message-types.md 一致", () => {
    expect(sorted(AGENT_MESSAGE_ROLES)).toEqual(
      sorted(matches(docs.messages, /role: "([A-Za-z]+)";/g)),
    );
  });

  it("会话条目类型与 session-format.md、SessionEntry 联合一致", () => {
    const examples = matches(docs.session, /^\{"type":"([a-z_]+)"/gm).filter(
      (t) => t !== "session",
    );
    expect(sorted(SESSION_ENTRY_TYPES)).toEqual(sorted(examples));
    const entryTypes = matches(
      src.sessionManager,
      /^export interface \w+Entry(?:<T = unknown>)? extends SessionEntryBase \{\n\ttype: "([a-z_]+)";/gm,
    );
    expect(sorted(SESSION_ENTRY_TYPES)).toEqual(sorted(entryTypes));
  });
});
