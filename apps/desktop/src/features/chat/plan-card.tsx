"use client";

// 计划模式（primus-plan）的两块界面：
// - PlanCard：时间线里 plan_submit 的计划卡片（标题、概述、步骤、风险、验证、假设），带审批结果；
//   等待批准或刚提交的展开，其余默认收起成一行，点开再看。
// - PlanApproval：等待批准时显示在输入框上方（与操作确认同一位置）：批准并执行、批准但每步询问、带意见继续完善。
import type { PlanApprovePermission, PlanDoc, PlanSubmitDetails } from "@primus/protocol";
import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { MarkdownText } from "./message-content";

const t = strings.chat.plan;

/** 工具参数（可能不完整）里能显示的计划；还没有标题时返回 undefined */
export function planOfArgs(args: unknown): PlanDoc | undefined {
  const a = args as Partial<PlanDoc> | null | undefined;
  if (!a || typeof a.title !== "string" || !a.title.trim()) return undefined;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  return {
    title: a.title,
    summary: typeof a.summary === "string" ? a.summary : "",
    steps: Array.isArray(a.steps)
      ? a.steps
          .filter((s) => s && typeof s.title === "string")
          .map((s, i) => ({
            id: typeof s.id === "string" ? s.id : String(i + 1),
            title: s.title,
            ...(typeof s.detail === "string" ? { detail: s.detail } : {}),
            files: list(s.files),
          }))
      : [],
    verification: list(a.verification),
    risks: list(a.risks),
    assumptions: list(a.assumptions),
  };
}

type CardStatus = "writing" | "awaiting" | "approved" | "edited" | "revising" | "cancelled";

function Section({ title, items }: { title: string; items: readonly string[] | undefined }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">{title}</p>
      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-fg/85">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function PlanCard({
  args,
  details,
  running,
}: {
  /** plan_submit 的参数（流式中可能不完整） */
  args: unknown;
  /** 工具结果的 details；还没有结果时为 undefined */
  details?: PlanSubmitDetails;
  /** 工具仍在运行（等待批准或参数还在生成） */
  running: boolean;
}) {
  const plan = details?.plan ?? planOfArgs(args);
  const status: CardStatus = details
    ? details.status === "approved"
      ? details.edited
        ? "edited"
        : "approved"
      : details.status === "revising"
        ? "revising"
        : "cancelled"
    : running && plan && Array.isArray((args as { verification?: unknown })?.verification)
      ? "awaiting"
      : "writing";
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? (status === "awaiting" || status === "writing");
  const id = useId();
  // 工具报错（不在计划模式、格式不对等）：不显示卡片，工作过程里已有这次调用
  if (details && !["approved", "revising", "cancelled"].includes(details.status)) return null;
  if (!plan)
    return running ? (
      <p className="step-in flex items-center gap-2 text-sm text-muted">
        <Icon name="list-check" size="sm" />
        <span className="text-pulse">{t.writing}</span>
      </p>
    ) : null;
  const statusText =
    status === "writing" ? t.writing : t.status[status === "edited" ? "edited" : status];
  return (
    <section
      aria-label={`${t.card}：${plan.title}`}
      className="step-in overflow-hidden rounded-2xl bg-surface ring-1 ring-border"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setUserOpen(!open)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left outline-none transition-colors hover:bg-hover/50 focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Icon name="list-check" className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate font-medium text-base text-fg">{plan.title}</span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-2xs",
            status === "awaiting"
              ? "bg-accent/12 text-accent"
              : status === "approved" || status === "edited"
                ? "bg-hover text-fg"
                : "bg-hover text-muted",
            status === "writing" && "text-pulse",
          )}
        >
          {statusText}
        </span>
        <Icon
          name="chevron-right"
          size="sm"
          className={cn(
            "shrink-0 text-muted transition-[rotate] duration-300",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div id={id} className="flex flex-col gap-3 border-border border-t px-4 pt-3 pb-4">
          {plan.summary && (
            <MarkdownText text={plan.summary} streaming={false} className="text-base text-ink" />
          )}
          {plan.steps.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">{t.steps}</p>
              <ol className="flex flex-col gap-2">
                {plan.steps.map((s, i) => (
                  <li key={`${s.id}:${s.title}`} className="flex gap-2.5 text-sm">
                    <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-hover text-2xs text-muted tabular-nums">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-fg">{s.title}</p>
                      {s.detail && (
                        <p className="mt-0.5 whitespace-pre-wrap text-muted">{s.detail}</p>
                      )}
                      {s.files && s.files.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {s.files.map((f) => (
                            <code
                              key={f}
                              className="rounded-md bg-hover px-1.5 py-px font-mono text-2xs text-muted"
                            >
                              {f}
                            </code>
                          ))}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <Section title={t.risks} items={plan.risks} />
          <Section title={t.verification} items={plan.verification} />
          <Section title={t.assumptions} items={plan.assumptions} />
          {details?.feedback && (
            <p className="rounded-xl bg-hover px-3 py-2 text-sm text-muted">{details.feedback}</p>
          )}
        </div>
      )}
    </section>
  );
}

export function PlanApproval({
  title,
  fullAccess,
  onApprove,
  onRevise,
}: {
  title?: string;
  /** 当前是完全访问：主按钮保持完全访问，不降到自动编辑 */
  fullAccess: boolean;
  onApprove: (permission: PlanApprovePermission) => void;
  onRevise: (feedback: string) => void;
}) {
  const a = t.approval;
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const button =
    "rounded-full px-3.5 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40";
  return (
    <section
      role="alertdialog"
      aria-label={a.label}
      className="mx-auto mb-2 flex w-full max-w-xl flex-col gap-2.5 rounded-[18px] bg-surface px-4 py-3 text-sm shadow-[0_8px_30px_-12px_rgb(0_0_0/0.35)] ring-1 ring-border"
    >
      <div className="flex items-start gap-2.5">
        <Icon name="list-check" className="mt-0.5 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-fg">{a.title}</p>
          {title && <p className="mt-0.5 truncate text-muted">{title}</p>}
        </div>
      </div>
      {revising ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = feedback.trim();
            if (text) onRevise(text);
          }}
        >
          <textarea
            aria-label={a.feedbackLabel}
            placeholder={a.feedbackPlaceholder}
            value={feedback}
            // biome-ignore lint/a11y/noAutofocus: 点“继续完善”后直接输入意见
            autoFocus
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={3}
            className="w-full resize-none rounded-xl bg-hover/60 px-3 py-2 text-base outline-none ring-1 ring-border focus:ring-accent/40"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRevising(false)}
              className={cn(button, "text-muted hover:bg-hover hover:text-fg")}
            >
              {a.cancel}
            </button>
            <button
              type="submit"
              disabled={!feedback.trim()}
              className={cn(button, "bg-fg text-surface hover:opacity-90")}
            >
              {a.sendFeedback}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setRevising(true)}
            className={cn(button, "text-muted hover:bg-hover hover:text-fg")}
          >
            {a.revise}
          </button>
          <Tooltip content={a.approveAskHint}>
            <button
              type="button"
              onClick={() => onApprove("ask")}
              className={cn(button, "bg-hover text-fg hover:bg-hover/70")}
            >
              {a.approveAsk}
            </button>
          </Tooltip>
          <Tooltip content={fullAccess ? undefined : a.approveEditHint}>
            <button
              type="button"
              onClick={() => onApprove(fullAccess ? "keep" : "edit")}
              className={cn(button, "bg-fg text-surface hover:opacity-90")}
            >
              {a.approveEdit}
            </button>
          </Tooltip>
        </div>
      )}
    </section>
  );
}
