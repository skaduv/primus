"use client";

import type { AgentMessage } from "@primus/protocol";
import { type FormEvent, type KeyboardEvent, useEffect, useState } from "react";
import { isTauriRuntime } from "@/lib/platform";
import { strings } from "@/lib/strings";
import type { TimelineContent, ToolRun } from "@/stores/session-store";
import { useChatSession } from "./use-chat-session";

// 中央对话区：时间线 + 输入框。目前是纯文本的低保真版本，用来验证事件流重建；
// Markdown、代码高亮、虚拟列表等在后续任务中补上。

const t = strings.chat;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: { type?: string; text?: string }) => (c.type === "text" ? (c.text ?? "") : ""))
    .join("");
}

/** 消息没有独立 id：用角色 + 时间戳（工具结果再加调用 id）区分；流式中的消息尚无时间戳 */
function messageKey(m: AgentMessage): string {
  const r = m as { role: string; timestamp?: number; toolCallId?: string };
  return `${r.role}-${r.timestamp ?? "streaming"}-${r.toolCallId ?? ""}`;
}

function ToolStatus({ run }: { run: ToolRun | undefined }) {
  if (!run) return null;
  const label = { running: t.toolRunning, done: t.toolDone, error: t.toolError }[run.status];
  return <span className="ml-2 text-xs text-muted">{label}</span>;
}

function AssistantBlocks({
  content,
  toolRuns,
}: {
  content: TimelineContent[];
  toolRuns: Record<string, ToolRun>;
}) {
  return (
    <>
      {content.map((block, i) => {
        if (!block) return null;
        const key = `${block.type}-${i}`;
        if (block.type === "thinking")
          return (
            <p key={key} className="text-xs whitespace-pre-wrap text-muted">
              {t.thinking}：{block.thinking}
            </p>
          );
        if (block.type === "toolCall")
          return (
            <p key={key} className="rounded border border-border px-2 py-1 text-xs">
              {t.tool}：{block.name}
              <ToolStatus run={toolRuns[block.id]} />
            </p>
          );
        return (
          <p key={key} className="whitespace-pre-wrap">
            {block.text}
          </p>
        );
      })}
    </>
  );
}

function MessageItem({
  message,
  toolRuns,
}: {
  message: AgentMessage;
  toolRuns: Record<string, ToolRun>;
}) {
  if (message.role === "user")
    return (
      <article aria-label={t.you} className="self-end rounded-lg bg-hover px-3 py-2">
        <p className="whitespace-pre-wrap">{textOf(message.content)}</p>
      </article>
    );
  if (message.role === "assistant")
    return (
      <article aria-label={t.assistant} className="flex flex-col gap-1">
        <AssistantBlocks
          content={(message.content as TimelineContent[]) ?? []}
          toolRuns={toolRuns}
        />
      </article>
    );
  return null; // 工具结果并入对应的工具调用块显示
}

export function ChatPanel() {
  const { state, error, send, abort } = useChatSession();
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(false);

  // 只在客户端判断运行环境，避免水合不一致
  useEffect(() => setPreview(!isTauriRuntime()), []);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || state.running) return;
    setDraft("");
    void send(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  const shownError = error ?? state.lastError;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6 text-sm">
        {preview && <p className="self-center text-xs text-muted">{t.previewBadge}</p>}
        {state.messages.length === 0 ? (
          <p className="m-auto text-muted">{strings.layout.emptyTimeline}</p>
        ) : (
          state.messages.map((m) => (
            <MessageItem key={messageKey(m)} message={m} toolRuns={state.toolRuns} />
          ))
        )}
        {shownError && (
          <p role="alert" className="text-xs text-danger">
            {shownError}
          </p>
        )}
      </div>
      <form onSubmit={submit} className="flex items-end gap-2 border-t border-border p-3">
        <textarea
          aria-label={t.inputLabel}
          placeholder={t.inputPlaceholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          className="min-h-10 flex-1 resize-none rounded border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-fg"
        />
        {state.running ? (
          <button
            type="button"
            onClick={() => void abort()}
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-hover"
          >
            {t.stop}
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded bg-fg px-3 py-1.5 text-sm text-surface disabled:opacity-40"
          >
            {t.send}
          </button>
        )}
      </form>
    </div>
  );
}
