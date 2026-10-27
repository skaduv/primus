"use client";

import type { AgentMessage } from "@primus/protocol";
import { ArrowUp, Paperclip, ShieldCheck, Square, Wrench } from "lucide-react";
import { type FormEvent, type KeyboardEvent, memo, useEffect, useRef, useState } from "react";
import { glassButtonClass, useGlassStyle } from "@/components/layout/glass-panel";
import { useMediaQuery } from "@/components/theme/appearance-controller";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { isTauriRuntime } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";
import type { TimelineContent, ToolRun } from "@/stores/session-store";
import { useChatSession } from "./use-chat-session";

// 中央对话区：实色"纸面"上的时间线 + 悬浮在其上的玻璃输入框（滚动内容从玻璃下方折射穿过）。
// 低保真：纯文本渲染；Markdown、代码高亮、虚拟列表在后续任务补上。

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

const statusDot: Record<ToolRun["status"], string> = {
  running: "bg-accent animate-pulse",
  done: "bg-emerald-500",
  error: "bg-danger",
};

function ToolCard({ name, run }: { name: string; run: ToolRun | undefined }) {
  const label = run
    ? { running: t.toolRunning, done: t.toolDone, error: t.toolError }[run.status]
    : undefined;
  return (
    <div className="flex items-center gap-2 self-start rounded-xl bg-surface/70 px-3 py-1.5 text-xs ring-1 ring-border">
      <Wrench aria-hidden size={13} className="text-muted" />
      <span>
        {t.tool}：{name}
      </span>
      {run && (
        <span className="ml-1 flex items-center gap-1.5 text-muted">
          <span aria-hidden className={cn("size-1.5 rounded-full", statusDot[run.status])} />
          {label}
        </span>
      )}
    </div>
  );
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
            <details key={key} className="group text-xs text-muted">
              <summary className="cursor-default select-none list-none">
                <span className="rounded-full bg-hover px-2 py-0.5">{t.thinking}</span>
              </summary>
              <p className="mt-1.5 whitespace-pre-wrap border-l-2 border-border pl-3">
                {block.thinking}
              </p>
            </details>
          );
        if (block.type === "toolCall")
          return <ToolCard key={key} name={block.name} run={toolRuns[block.id]} />;
        return (
          <p key={key} className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed">
            {block.text}
          </p>
        );
      })}
    </>
  );
}

const MessageItem = memo(function MessageItem({
  message,
  toolRuns,
}: {
  message: AgentMessage;
  toolRuns: Record<string, ToolRun>;
}) {
  if (message.role === "user")
    return (
      <article
        aria-label={t.you}
        className="max-w-[80%] self-end rounded-[18px] rounded-br-md bg-accent px-3.5 py-2 text-white"
      >
        <p className="whitespace-pre-wrap leading-relaxed">{textOf(message.content)}</p>
      </article>
    );
  if (message.role === "assistant")
    return (
      <article aria-label={t.assistant} className="flex flex-col gap-2">
        <AssistantBlocks
          content={(message.content as TimelineContent[]) ?? []}
          toolRuns={toolRuns}
        />
      </article>
    );
  return null; // 工具结果并入对应的工具卡片显示
});

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  const glass = useGlassStyle();
  return (
    <div className="m-auto flex max-w-md flex-col items-center gap-3 text-center">
      <h2 className="font-serif text-3xl font-medium tracking-tight">{t.welcomeTitle}</h2>
      <p className="text-sm text-muted">{t.welcomeSubtitle}</p>
      <p className="sr-only">{strings.layout.emptyTimeline}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {t.suggestions.map((s) => (
          <GlassButton
            key={s}
            variant="capsule"
            size={32}
            {...glass}
            className={glassButtonClass}
            onClick={() => onPick(s)}
          >
            <span className="text-[13px]">{s}</span>
          </GlassButton>
        ))}
      </div>
    </div>
  );
}

/** 距底部小于该值视为"停在底部" */
const STICK_THRESHOLD_PX = 48;
/** 时间线底部在悬浮输入框之上再留出的间距 */
const COMPOSER_GAP_PX = 16;
/** 首帧（尚未量到输入框高度）时的底部留白，约等于两行输入框的静止高度 */
const COMPOSER_FALLBACK_PX = 128;

/**
 * 量取悬浮输入框的实际高度（含其下边距），随输入行数增减实时更新。
 * 时间线据此留出底部空间：欢迎页与最后一条消息永远不会被玻璃输入框盖住，放不下时可滚动。
 */
function useElementHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 高度为 0（尚未布局或被隐藏）时视为未量到，沿用首帧留白
    const read = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      setHeight(h > 0 ? h : null);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, height] as const;
}

export function ChatPanel() {
  const { state, error, send, abort } = useChatSession();
  const composerGlass = useGlassStyle(0.1);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [composerRef, composerHeight] = useElementHeight<HTMLDivElement>();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  // 只在客户端判断运行环境，避免水合不一致
  useEffect(() => setPreview(!isTauriRuntime()), []);

  // 贴底：只有用户停在底部附近或刚发送消息时，新内容到达才滚到底部；
  // 用户向上翻看历史时，流式更新不打断阅读（后续换成虚拟列表的"贴底"逻辑）
  const stickToBottom = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  };
  const lastMessage = state.messages.at(-1);
  useEffect(() => {
    if (!lastMessage || !stickToBottom.current) return;
    const el = scrollRef.current;
    el?.scrollTo?.({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  }, [lastMessage, reducedMotion]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || state.running) return;
    setDraft("");
    stickToBottom.current = true;
    void send(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  const shownError = error ?? state.lastError;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6 text-sm"
        style={{ paddingBottom: (composerHeight ?? COMPOSER_FALLBACK_PX) + COMPOSER_GAP_PX }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4">
          {preview && (
            <p className="self-center rounded-full bg-hover px-2.5 py-0.5 text-[11px] text-muted">
              {t.previewBadge}
            </p>
          )}
          {state.messages.length === 0 ? (
            <Welcome
              onPick={(s) => {
                setDraft(s);
                inputRef.current?.focus();
              }}
            />
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
      </div>

      <div ref={composerRef} className="pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-4">
        <GlassSurface
          blur={20}
          radius={24}
          {...composerGlass}
          className="pointer-events-auto mx-auto max-w-3xl shadow-[0_12px_40px_-12px_rgb(0_0_0/0.35)]"
        >
          <form onSubmit={submit} className="flex flex-col gap-1 px-4 pt-3 pb-2.5">
            <textarea
              ref={inputRef}
              aria-label={t.inputLabel}
              placeholder={t.inputPlaceholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              className="max-h-48 min-h-11 w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted"
            />
            <div className="flex items-center gap-2 text-xs text-muted">
              <button
                type="button"
                aria-label={t.attach}
                title={t.attachSoon}
                // 附件选择在后续任务接入，接入前禁用
                disabled
                className="rounded-full p-1.5 enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Paperclip aria-hidden size={15} />
              </button>
              <span
                title={t.permissionMode}
                className="flex items-center gap-1 rounded-full bg-hover px-2 py-1"
              >
                <ShieldCheck aria-hidden size={13} />
                {t.permissionAsk}
              </span>
              <span title={t.context} className="flex items-center gap-1.5 px-1">
                <span
                  aria-hidden
                  className="relative h-1 w-10 overflow-hidden rounded-full bg-hover"
                >
                  <span className="absolute inset-y-0 left-0 w-0 bg-accent" />
                </span>
                {t.context} 0%
              </span>
              <span className="flex-1" />
              {state.running ? (
                <button
                  type="button"
                  aria-label={t.stop}
                  onClick={() => void abort()}
                  className="grid size-8 place-items-center rounded-full bg-fg text-surface"
                >
                  <Square aria-hidden size={12} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  aria-label={t.send}
                  disabled={!draft.trim()}
                  className="grid size-8 place-items-center rounded-full bg-accent text-white transition-opacity disabled:opacity-30"
                >
                  <ArrowUp aria-hidden size={16} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </form>
        </GlassSurface>
      </div>
    </div>
  );
}
