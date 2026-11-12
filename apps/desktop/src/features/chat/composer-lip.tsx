"use client";

// 输入框上沿后面的“唇条”：一条灰色小舌，显示当前 Git 分支与工作区（工作区选择从底栏移到这里，功能不变）。
// 不是 Git 仓库时不显示分支；会话开始后工作区锁定，只显示名称。
// 有待办（primus-plan 的计划步骤 / todo）时唇条正中显示进度与当前步骤（进行中的用转动图标），
// 悬停或键盘聚焦弹出全部步骤。左侧分支与工作区位置固定；进度在整条唇条里居中，左边让开工作区，
// 右边放不下时文字渐隐截断。
import { currentTodo, type TodoItem } from "@primus/protocol";
import { HoverCard } from "radix-ui";
import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/icons";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Tooltip } from "@/components/ui/tooltip";
import { getPlatform } from "@/lib/platform";
import type { GitBranch as Branch, WorkspaceInfo } from "@/lib/platform/types";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { WorkspacePicker } from "./composer-menus";

const t = strings.chat;

/** 工作区所在仓库的当前分支；路径变化时重新读取，迟到的旧结果丢弃 */
function useGitBranch(path: string | null): Branch | null {
  const [branch, setBranch] = useState<{ path: string; value: Branch | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    getPlatform()
      .then((p) => p.gitBranch(path))
      .then((value) => !cancelled && setBranch({ path, value }))
      .catch(() => !cancelled && setBranch({ path, value: null }));
    return () => {
      cancelled = true;
    };
  }, [path]);
  return path && branch?.path === path ? branch.value : null;
}

/** 一个待办的状态标记：完成为对勾、跳过为横线、进行中为转动的加载图标（强调色）、未开始为空心圆 */
export function TodoMark({ status }: { status: TodoItem["status"] }) {
  if (status === "completed") return <Icon name="check" size="xs" className="text-muted" />;
  if (status === "skipped") return <Icon name="minus" size="xs" className="text-muted" />;
  if (status === "in_progress")
    return (
      <Icon
        name="loader"
        size="sm"
        label={strings.chat.todoStatus.in_progress}
        className="session-spinner shrink-0 text-accent"
      />
    );
  return <span aria-hidden className="m-[3px] size-2 shrink-0 rounded-full ring-1 ring-current" />;
}

/**
 * 计划进度在唇条里的位置：在整条唇条里水平居中；左边不压到工作区（让到它右侧 16px 之后），
 * 右边放不下时由文字渐隐截断。返回定位样式与文字是否溢出（溢出时加渐隐遮罩）
 */
function useCenteredSlot(
  lip: RefObject<HTMLDivElement | null>,
  left: RefObject<HTMLDivElement | null>,
  slot: RefObject<HTMLButtonElement | null>,
  text: RefObject<HTMLSpanElement | null>,
  /** 显示内容的摘要：变化时重新测量（尺寸变化由 ResizeObserver 处理） */
  contentKey: string,
): { style: CSSProperties; overflow: boolean } {
  const [layout, setLayout] = useState<{ style: CSSProperties; overflow: boolean }>({
    style: { left: "50%", translate: "-50% 0", maxWidth: "50%" },
    overflow: false,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey 不在回调里读取，只用来在内容变化时重新测量
  useLayoutEffect(() => {
    const lipEl = lip.current;
    const slotEl = slot.current;
    const textEl = text.current;
    if (!lipEl || !slotEl || !textEl) return;
    const measure = () => {
      const width = lipEl.clientWidth;
      const pad = Number.parseFloat(getComputedStyle(lipEl).paddingRight) || 14;
      const leftEl = left.current;
      const leftEdge =
        leftEl && leftEl.offsetWidth > 0 ? leftEl.offsetLeft + leftEl.offsetWidth + 16 : pad;
      // 不截断时的宽度：按钮宽度减去文字可见宽度，加上文字完整宽度
      const natural = slotEl.offsetWidth - textEl.clientWidth + textEl.scrollWidth;
      const x = Math.max(leftEdge, (width - natural) / 2);
      const maxWidth = Math.max(0, width - pad - x);
      setLayout({
        style: { left: x, maxWidth },
        overflow: natural > maxWidth + 0.5,
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(lipEl);
    if (left.current) ro.observe(left.current);
    return () => ro.disconnect();
  }, [lip, left, slot, text, contentKey]);
  return layout;
}

/** 计划进度：当前步骤一行；悬停或键盘聚焦弹出全部步骤（与模型选择同款的玻璃弹层） */
export function TodoProgress({
  items,
  slotRef,
  textRef,
  style,
  overflow = false,
}: {
  items: readonly TodoItem[];
  slotRef?: RefObject<HTMLButtonElement | null>;
  textRef?: RefObject<HTMLSpanElement | null>;
  /** 唇条算好的位置（绝对定位）；缺省时随文档流 */
  style?: CSSProperties;
  /** 文字放不下：右端渐隐 */
  overflow?: boolean;
}) {
  const current = currentTodo(items);
  const labelId = useId();
  // 弹层（HoverCard）会被辅助技术忽略：全部步骤另外渲染一份视觉隐藏的列表，按钮用 aria-describedby 关联
  const listId = useId();
  if (!current) return null;
  const done = items.filter((i) => i.status === "completed" || i.status === "skipped").length;
  return (
    <>
      <ol id={listId} className="sr-only">
        {items.map((item) => (
          <li key={item.id}>{`${t.todoStatus[item.status]}：${item.text}`}</li>
        ))}
      </ol>
      <HoverCard.Root openDelay={120} closeDelay={80}>
        <HoverCard.Trigger asChild>
          {/* 按钮只为能被键盘聚焦（聚焦同样弹出全部步骤），点击没有动作 */}
          <button
            ref={slotRef}
            type="button"
            style={style}
            aria-label={`${t.lip.todo} ${done}/${items.length}：${current.text}`}
            aria-describedby={listId}
            className={cn(
              "lip-item-in flex min-w-0 cursor-default items-center gap-1.5 rounded-md outline-none transition-colors hover:text-fg focus-visible:text-fg data-[state=open]:text-fg",
              style && "absolute top-0 h-8",
            )}
          >
            <span className="flex w-3.5 shrink-0 justify-center">
              <TodoMark status={current.status} />
            </span>
            <span className="shrink-0 tabular-nums">
              {done}/{items.length}
            </span>
            <span
              ref={textRef}
              className={cn(
                "min-w-0 overflow-hidden whitespace-nowrap text-fg/80",
                overflow &&
                  "[mask-image:linear-gradient(to_right,#000_calc(100%-32px),transparent)]",
              )}
            >
              {current.text}
            </span>
          </button>
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            side="top"
            align="center"
            sideOffset={10}
            collisionPadding={12}
            className="glass-pop z-50 outline-none [--glass-origin:var(--radix-hover-card-content-transform-origin)]"
          >
            <GlassSurface blur={30} radius={22} tint={0.8}>
              <section
                aria-labelledby={labelId}
                className="w-[min(360px,calc(100vw-24px))] min-w-[280px] py-2"
              >
                <p
                  id={labelId}
                  className="flex items-baseline gap-1.5 px-4 pt-0.5 pb-1 text-2xs font-medium text-muted"
                >
                  <span>{t.lip.todoAll}</span>
                  <span className="tabular-nums">
                    {done}/{items.length}
                  </span>
                </p>
                <ol className="scroll-none max-h-[min(24rem,50vh)] overflow-y-auto overscroll-contain">
                  {items.map((item) => {
                    const finished = item.status === "completed" || item.status === "skipped";
                    return (
                      <li
                        key={item.id}
                        aria-current={item.status === "in_progress" ? "step" : undefined}
                        className={cn(
                          "mx-1.5 flex items-start gap-2.5 rounded-[10px] px-2.5 py-[7px] text-sm text-fg",
                          item.status === "in_progress" && "bg-black/[0.06] dark:bg-white/[0.1]",
                          finished && "text-muted line-through",
                        )}
                      >
                        <span className="mt-[3px] flex w-3.5 shrink-0 justify-center text-muted">
                          <TodoMark status={item.status} />
                        </span>
                        <span className="min-w-0 flex-1 break-words">
                          <span className="sr-only">{`${t.todoStatus[item.status]}：`}</span>
                          {item.text}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            </GlassSurface>
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>
    </>
  );
}

export function ComposerLip({
  workspace,
  locked,
  onPicked,
  onClear,
  onError,
  todos = [],
  showWorkspace = true,
}: {
  /** 待办清单（没有未完成的项时不显示进度） */
  todos?: readonly TodoItem[];
  /** 显示分支与工作区（平台不支持工作区时为 false，唇条只显示计划进度） */
  showWorkspace?: boolean;
  workspace: WorkspaceInfo | null;
  /** 会话已开始：工作区不能再切换 */
  locked: boolean;
  onPicked: (ws: WorkspaceInfo) => void;
  onClear: () => void;
  onError: (message: string | null) => void;
}) {
  const branch = useGitBranch(showWorkspace ? (workspace?.path ?? null) : null);
  const current = currentTodo(todos);
  const hasTodo = current !== undefined;
  const lipRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const done = todos.filter((i) => i.status === "completed" || i.status === "skipped").length;
  const slot = useCenteredSlot(
    lipRef,
    leftRef,
    slotRef,
    textRef,
    [current?.text, current?.status, done, todos.length, workspace?.path, branch?.name].join("|"),
  );
  const workspacePart = showWorkspace && (workspace || !locked);
  if (!workspacePart && !hasTodo) return null;
  const item = "lip-item-in flex min-w-0 items-center gap-1.5";
  return (
    <div
      ref={lipRef}
      className="composer-lip relative mx-3.5 -mb-3 flex h-11 items-center rounded-t-2xl bg-lip px-3.5 pb-3 text-xs text-muted shadow-[inset_0_0_0_1px_var(--color-border)]"
    >
      {/* 左侧固定：分支与工作区；计划进度绝对定位在整条唇条的正中（见 useCenteredSlot） */}
      <div ref={leftRef} className="flex min-w-0 shrink-0 items-center gap-4">
        {workspacePart && branch && (
          <Tooltip
            key={`${workspace?.path}:${branch.name}`}
            content={`${t.lip.branch}：${branch.name}${branch.detached ? `（${t.lip.detached}）` : ""}`}
          >
            <span className={item}>
              <Icon name="git-branch" size="sm" />
              <span className="max-w-40 truncate">{branch.name}</span>
            </span>
          </Tooltip>
        )}
        {!workspacePart ? null : !workspace ? (
          <WorkspacePicker current={null} onPicked={onPicked} onError={onError}>
            <button
              type="button"
              className="flex items-center gap-1.5 outline-none transition-colors hover:text-fg focus-visible:text-fg data-[state=open]:text-fg"
            >
              <Icon name="folder-open" size="sm" />
              <span>{t.chooseFolder}</span>
            </button>
          </WorkspacePicker>
        ) : locked ? (
          // 会话已绑定到开始时的工作区，之后不能切换，避免界面与 Core 实际工作区不一致
          <Tooltip content={`${t.currentWorkspace}：${workspace.path}\n${t.workspaceLocked}`}>
            <span className={item}>
              <Icon name="folder" size="sm" />
              <span className="max-w-48 truncate">{workspace.name}</span>
            </span>
          </Tooltip>
        ) : (
          // 悬停（或键盘聚焦）时文件夹图标换成关闭按钮，取消已选的工作区。
          // 关闭按钮是触发器的兄弟元素、叠在图标位置上（按钮里不能嵌套按钮），点它不会打开菜单
          <span key={workspace.path} className={`${item} group/ws relative`}>
            <WorkspacePicker current={workspace} onPicked={onPicked} onError={onError}>
              <Tooltip content={`${t.currentWorkspace}：${workspace.path}`}>
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1.5 outline-none transition-colors hover:text-fg focus-visible:text-fg data-[state=open]:text-fg"
                >
                  <Icon
                    name="folder"
                    size="sm"
                    className="transition-opacity group-focus-within/ws:opacity-0 group-hover/ws:opacity-0"
                  />
                  <span className="max-w-48 truncate">{workspace.name}</span>
                </button>
              </Tooltip>
            </WorkspacePicker>
            <Tooltip content={t.clearWorkspace}>
              <button
                type="button"
                aria-label={`${t.clearWorkspace} ${workspace.name}`}
                onClick={onClear}
                className="absolute -left-[3px] top-1/2 grid size-[19px] -translate-y-1/2 place-items-center rounded-full opacity-0 outline-none transition-opacity hover:bg-hover hover:text-fg focus-visible:opacity-100 group-focus-within/ws:opacity-100 group-hover/ws:opacity-100"
              >
                <Icon name="x" size="xs" />
              </button>
            </Tooltip>
          </span>
        )}
      </div>
      <TodoProgress
        items={todos}
        slotRef={slotRef}
        textRef={textRef}
        style={slot.style}
        overflow={slot.overflow}
      />
    </div>
  );
}
