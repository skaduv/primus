"use client";

import type { AgentMessage } from "@primus/protocol";
import { ArrowUp, Folder, FolderOpen, Plus, Square, Wrench } from "lucide-react";
import { type FormEvent, type KeyboardEvent, memo, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/brand/logo";
import { glassButtonClass, useGlassStyle } from "@/components/layout/glass-panel";
import { useMediaQuery } from "@/components/theme/appearance-controller";
import { GlassButton } from "@/components/ui/glass-button";
import {
  GlassPopover,
  GlassPopoverContent,
  GlassPopoverTrigger,
} from "@/components/ui/glass-popover";
import { GlassSurface } from "@/components/ui/glass-surface";
import { getPlatform, isTauriRuntime } from "@/lib/platform";
import type { WorkspaceInfo } from "@/lib/platform/types";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import type { TimelineContent, ToolRun } from "@/stores/session-store";
import {
  AttachmentChips,
  PermissionPicker,
  permissionMeta,
  WorkspacePicker,
  withAttachments,
} from "./composer-menus";
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

// 欢迎页：标志 + 标题 + 三个液态玻璃建议按钮
function Welcome({ onPick }: { onPick: (text: string) => void }) {
  const glass = useGlassStyle();
  return (
    <div className="m-auto flex max-w-2xl flex-col items-center gap-5 text-center">
      <LogoMark size={60} className="text-fg/80" />
      <h2 className="font-serif text-[28px] font-medium tracking-tight">{t.welcomeTitle}</h2>
      <p className="sr-only">{strings.layout.emptyTimeline}</p>
      <div className="flex flex-wrap justify-center gap-2.5">
        {t.suggestions.map((s) => (
          <GlassButton
            key={s}
            variant="capsule"
            size={36}
            {...glass}
            className={glassButtonClass}
            onClick={() => onPick(s)}
          >
            <span className="text-[13px] font-normal">{s}</span>
          </GlassButton>
        ))}
      </div>
    </div>
  );
}

/**
 * 输入框上方附着的液态玻璃条：未选择工作区时提示选择文件夹（可不选直接对话）。
 * 选好工作区或开始对话后收起（高度与透明度过渡）。
 */
function WorkspaceBar({
  visible,
  current,
  onPicked,
}: {
  visible: boolean;
  current: WorkspaceInfo | null;
  onPicked: (ws: WorkspaceInfo) => void;
}) {
  const glass = useGlassStyle(0.2);
  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        "grid transition-[grid-template-rows,opacity,transform] duration-300 ease-out",
        visible ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] translate-y-3 opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden px-4">
        <GlassSurface
          blur={24}
          radius={18}
          {...glass}
          sheen={false}
          className="-mb-5 pb-5 ring-1 ring-black/[0.06] dark:ring-white/[0.08]"
        >
          <div className="flex h-10 items-center px-4">
            <WorkspacePicker current={current} onPicked={onPicked}>
              <button
                type="button"
                className="flex items-center gap-2 text-[13px] text-muted outline-none transition-colors hover:text-fg focus-visible:text-fg data-[state=open]:text-fg"
              >
                <FolderOpen aria-hidden size={15} />
                <span className="font-medium">{t.chooseFolder}</span>
              </button>
            </WorkspacePicker>
          </div>
        </GlassSurface>
      </div>
    </div>
  );
}

/** 上下文占用：只显示小圆环，点击展开详情 */
function ContextRing({ percent }: { percent: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <GlassPopover>
      <GlassPopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${t.context} ${percent}%`}
          className="grid size-8 place-items-center rounded-full outline-none transition-colors hover:bg-hover data-[state=open]:bg-hover"
        >
          <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" className="-rotate-90">
            <circle
              cx="9"
              cy="9"
              r={r}
              fill="none"
              strokeWidth="2.25"
              className="stroke-black/10 dark:stroke-white/15"
            />
            <circle
              cx="9"
              cy="9"
              r={r}
              fill="none"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - percent / 100)}
              className="stroke-accent"
            />
          </svg>
        </button>
      </GlassPopoverTrigger>
      <GlassPopoverContent side="top" align="end" sideOffset={8} tint={0.75} minWidth={200}>
        <div className="flex flex-col gap-1.5 px-4 py-1.5 text-[13px]">
          <div className="flex items-baseline justify-between gap-6">
            <span className="font-medium">{t.context}</span>
            <span className="tabular-nums text-muted">{percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-[12px] text-muted">{t.contextDetail}</p>
        </div>
      </GlassPopoverContent>
    </GlassPopover>
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
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [composerRef, composerHeight] = useElementHeight<HTMLDivElement>();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const glass = useGlassStyle();
  const workspace = useAppStore((s) => s.workspace);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const [attachments, setAttachments] = useState<string[]>([]);
  const PermissionIcon = permissionMeta[permissionMode].icon;

  // 附件只取本地路径（不复制文件），去重后追加
  const pickFiles = () =>
    getPlatform()
      .then((p) => p.dialogPickFiles())
      .then((paths) => setAttachments((prev) => [...new Set([...prev, ...paths])]))
      .catch(() => {});

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
    if ((!text && attachments.length === 0) || state.running) return;
    setDraft("");
    setAttachments([]);
    stickToBottom.current = true;
    void send(withAttachments(text, attachments));
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
        <div className="pointer-events-auto mx-auto max-w-3xl">
          <WorkspaceBar
            visible={!workspace && state.messages.length === 0}
            current={workspace}
            onPicked={setWorkspace}
          />
          {/* 中央已是玻璃，输入框保持实色白底（深色为实色面），保证输入区清晰 */}
          <div className="relative rounded-[24px] bg-surface shadow-[0_12px_40px_-12px_rgb(0_0_0/0.35)] ring-1 ring-border">
            <form onSubmit={submit} className="flex flex-col gap-1.5 px-3 pt-3 pb-2.5">
              <AttachmentChips
                paths={attachments}
                onRemove={(p) => setAttachments((prev) => prev.filter((x) => x !== p))}
              />
              <textarea
                ref={inputRef}
                aria-label={t.inputLabel}
                placeholder={t.inputPlaceholder}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                className="max-h-48 min-h-11 w-full resize-none bg-transparent px-1 text-sm leading-relaxed outline-none placeholder:text-muted/55"
              />
              <div className="flex items-center gap-3 text-xs text-muted">
                {/* 附件：系统文件对话框选文件，只引用本地路径 */}
                <GlassButton
                  size={30}
                  {...glass}
                  aria-label={t.attach}
                  title={t.attach}
                  onClick={() => void pickFiles()}
                  className={glassButtonClass}
                >
                  <Plus aria-hidden size={16} />
                </GlassButton>
                <PermissionPicker mode={permissionMode} onChange={setPermissionMode}>
                  <GlassButton
                    variant="capsule"
                    size={30}
                    {...glass}
                    aria-label={`${t.permissionMode}：${t.permissions[permissionMode].label}`}
                    className={glassButtonClass}
                  >
                    <PermissionIcon
                      aria-hidden
                      size={14}
                      strokeWidth={1.9}
                      className={permissionMeta[permissionMode].tone}
                    />
                    <span
                      className={cn(
                        "text-[12px] font-normal",
                        permissionMode === "full" && permissionMeta.full.tone,
                      )}
                    >
                      {t.permissions[permissionMode].short}
                    </span>
                  </GlassButton>
                </PermissionPicker>
                {workspace && (
                  <WorkspacePicker current={workspace} onPicked={setWorkspace}>
                    <GlassButton
                      variant="capsule"
                      size={30}
                      {...glass}
                      title={`${t.currentWorkspace}：${workspace.path}`}
                      className={glassButtonClass}
                    >
                      <Folder aria-hidden size={14} />
                      <span className="max-w-40 truncate text-[12px] font-normal">
                        {workspace.name}
                      </span>
                    </GlassButton>
                  </WorkspacePicker>
                )}
                <span className="flex-1" />
                <ContextRing percent={0} />
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
                    disabled={!draft.trim() && attachments.length === 0}
                    className="grid size-8 place-items-center rounded-full bg-fg text-surface transition-[opacity,transform] active:scale-95 disabled:opacity-20 disabled:active:scale-100"
                  >
                    <ArrowUp aria-hidden size={16} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
