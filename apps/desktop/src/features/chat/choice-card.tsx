"use client";

// 输入框上方的“选择卡片”：ask_user 提问与计划审批共用。视觉与模型选择弹层一致：玻璃底板、
// 小号灰色小节标题、圆角高亮的选项行（序号、名称、灰色说明）；最后一行是输入框，
// 用户可以不选前面的选项，直接写自己的想法（Enter 发送）。
// 键盘：数字键 1–9 选对应选项（焦点不在输入框时）；↑↓ 在选项与输入框之间移动；Esc 关闭（有关闭时）。
// 焦点（alertdialog）：出现时（含换题重新挂载）聚焦第一行；关闭时回到出现前的位置（通常是聊天输入框），
// 那个元素已不在页面上（上一题的卡片）时，交给下一张卡片或浏览器默认处理。
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Tooltip } from "@/components/ui/tooltip";

export interface ChoiceOption {
  /** 稳定的键（同一张卡片内唯一） */
  key: string;
  label: string;
  description?: string;
  /** 推荐项：名称后加小标记 */
  recommended?: boolean;
}

/** 选项行：与输入栏菜单的 rowClass 同尺寸，高亮改用悬停 / 聚焦 */
const rowClass =
  "mx-1.5 flex w-[calc(100%-0.75rem)] cursor-default select-none items-start gap-2.5 rounded-[10px] px-2.5 py-[7px] text-left text-sm text-fg outline-none " +
  "hover:bg-black/[0.06] focus-visible:bg-black/[0.06] dark:hover:bg-white/[0.1] dark:focus-visible:bg-white/[0.1]";

export function ChoiceCard({
  label,
  icon,
  header,
  progress,
  title,
  options,
  otherPlaceholder,
  otherLabel,
  recommendedLabel,
  sendLabel,
  dismissLabel,
  onChoose,
  onOther,
  onDismiss,
  footer,
}: {
  /** 卡片的无障碍名称 */
  label: string;
  icon: IconName;
  /** 小节标题（小号灰字），如问题的简短标签 */
  header?: string;
  /** 进度（如“1/3”），显示在小节标题右侧 */
  progress?: string;
  /** 卡片主问题 */
  title: string;
  options: readonly ChoiceOption[];
  otherPlaceholder: string;
  otherLabel: string;
  recommendedLabel?: string;
  sendLabel: string;
  dismissLabel?: string;
  onChoose: (key: string) => void;
  onOther: (text: string) => void;
  /** 关闭卡片；缺省时不显示关闭按钮 */
  onDismiss?: () => void;
  footer?: ReactNode;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descBase = useId();

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = listRef.current?.querySelector<HTMLElement>("[data-choice-row]");
    first?.focus({ preventScroll: true });
    return () => {
      const inside = listRef.current?.contains(document.activeElement) ?? false;
      const lost = document.activeElement === document.body || document.activeElement === null;
      if (before?.isConnected && (inside || lost)) before.focus({ preventScroll: true });
    };
  }, []);

  const focusables = () =>
    [...(listRef.current?.querySelectorAll<HTMLElement>("[data-choice-row]") ?? [])].filter(
      (el) => !(el as HTMLButtonElement).disabled,
    );
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing) return;
    const inInput = (e.target as HTMLElement).tagName === "INPUT";
    if (e.key === "Escape" && onDismiss) {
      e.preventDefault();
      onDismiss();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = focusables();
      const i = rows.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
      rows[next]?.focus();
      return;
    }
    if (!inInput && !e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
      const option = options[Number(e.key) - 1];
      if (option) {
        e.preventDefault();
        onChoose(option.key);
      }
    }
  };
  const send = () => {
    const value = text.trim();
    if (value) onOther(value);
  };

  return (
    <GlassSurface
      blur={30}
      radius={22}
      tint={0.8}
      className="mx-auto mb-2 w-full max-w-xl shadow-[0_8px_30px_-12px_rgb(0_0_0/0.35)]"
    >
      <section
        role="alertdialog"
        aria-label={label}
        aria-describedby={titleId}
        onKeyDown={onKeyDown}
        className="py-2"
      >
        <div className="flex items-center gap-2 px-4 pt-0.5 pb-1">
          <Icon name={icon} size="sm" className="shrink-0 text-muted" />
          <p className="min-w-0 flex-1 truncate text-2xs font-medium text-muted">
            {header ?? label}
          </p>
          {progress && (
            <span className="shrink-0 text-2xs tabular-nums text-muted">{progress}</span>
          )}
          {onDismiss && dismissLabel && (
            <Tooltip content={dismissLabel}>
              <button
                type="button"
                aria-label={dismissLabel}
                onClick={onDismiss}
                className="-mr-1.5 grid size-6 shrink-0 place-items-center rounded-full text-muted outline-none hover:bg-hover hover:text-fg focus-visible:bg-hover"
              >
                <Icon name="x" size="xs" />
              </button>
            </Tooltip>
          )}
        </div>
        <p id={titleId} className="px-4 pb-1.5 text-sm font-medium leading-snug text-fg">
          {title}
        </p>
        <div ref={listRef} className="flex flex-col">
          {options.map((o, i) => (
            <button
              key={o.key}
              type="button"
              data-choice-row
              aria-label={o.label}
              aria-describedby={o.description ? `${descBase}-${i}` : undefined}
              onClick={() => onChoose(o.key)}
              className={rowClass}
            >
              <span
                aria-hidden
                className="mt-px grid size-[18px] shrink-0 place-items-center rounded-md bg-black/[0.05] text-2xs tabular-nums text-muted dark:bg-white/[0.08]"
              >
                {i + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="leading-snug">
                  {o.label}
                  {o.recommended && recommendedLabel && (
                    <span className="ml-1.5 text-2xs text-accent">{recommendedLabel}</span>
                  )}
                </span>
                {o.description && (
                  <span id={`${descBase}-${i}`} className="text-xs leading-snug text-muted">
                    {o.description}
                  </span>
                )}
              </span>
            </button>
          ))}
          {/* 最后一行：自己写想法（不用先选前面的选项） */}
          <form
            className="mx-1.5 flex items-center gap-2.5 rounded-[10px] px-2.5 py-[5px] focus-within:bg-black/[0.04] dark:focus-within:bg-white/[0.06]"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <span aria-hidden className="grid size-[18px] shrink-0 place-items-center text-muted">
              <Icon name="pen" size="xs" />
            </span>
            <input
              data-choice-row
              aria-label={otherLabel}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={otherPlaceholder}
              className="h-6 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted/70"
            />
            <button
              type="submit"
              aria-label={sendLabel}
              disabled={!text.trim()}
              className="grid size-6 shrink-0 place-items-center rounded-full bg-fg text-surface outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-0"
            >
              <Icon name="arrow-up" size="xs" />
            </button>
          </form>
        </div>
        {footer}
      </section>
    </GlassSurface>
  );
}
