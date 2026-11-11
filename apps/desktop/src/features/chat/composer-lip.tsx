"use client";

// 输入框上沿后面的“唇条”：一条灰色小舌，显示当前 Git 分支与工作区（工作区选择从底栏移到这里，功能不变）。
// 不是 Git 仓库时不显示分支；会话开始后工作区锁定，只显示名称。
// 有待办（primus-plan 的计划步骤 / todo）时唇条正中显示进度与当前步骤，悬停或键盘聚焦弹出全部步骤。
// 布局是三栏网格（左：分支与工作区；中：计划进度；右：空），两侧等宽，中间一栏始终居中。
import { currentTodo, type TodoItem } from "@primus/protocol";
import { HoverCard } from "radix-ui";
import { useEffect, useId, useState } from "react";
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

/** 一个待办的状态标记：完成为对勾、跳过为横线、进行中为强调色圆点、未开始为空心圆 */
function TodoMark({ status }: { status: TodoItem["status"] }) {
  if (status === "completed") return <Icon name="check" size="xs" className="text-muted" />;
  if (status === "skipped") return <Icon name="minus" size="xs" className="text-muted" />;
  return (
    <span
      aria-hidden
      className={cn(
        "m-[3px] size-1.5 shrink-0 rounded-full",
        status === "in_progress" ? "bg-accent" : "ring-1 ring-current",
      )}
    />
  );
}

/** 唇条中间的计划进度：当前步骤一行；悬停或键盘聚焦弹出全部步骤（与模型选择同款的玻璃弹层） */
export function TodoProgress({ items }: { items: readonly TodoItem[] }) {
  const current = currentTodo(items);
  const labelId = useId();
  if (!current) return null;
  const done = items.filter((i) => i.status === "completed" || i.status === "skipped").length;
  return (
    <HoverCard.Root openDelay={120} closeDelay={80}>
      <HoverCard.Trigger asChild>
        {/* 按钮只为能被键盘聚焦（聚焦同样弹出全部步骤），点击没有动作 */}
        <button
          type="button"
          aria-label={`${t.lip.todo} ${done}/${items.length}：${current.text}`}
          className="lip-item-in flex min-w-0 max-w-full cursor-default items-center gap-1.5 rounded-md outline-none transition-colors hover:text-fg focus-visible:text-fg data-[state=open]:text-fg"
        >
          <Icon name="list-check" size="sm" className="shrink-0" />
          <span className="shrink-0 tabular-nums">
            {done}/{items.length}
          </span>
          <span className="min-w-0 truncate text-fg/80">{current.text}</span>
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
                      <span className="min-w-0 flex-1 break-words">{item.text}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
          </GlassSurface>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
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
  const hasTodo = currentTodo(todos) !== undefined;
  const workspacePart = showWorkspace && (workspace || !locked);
  if (!workspacePart && !hasTodo) return null;
  const item = "lip-item-in flex min-w-0 items-center gap-1.5";
  return (
    <div className="composer-lip mx-3.5 -mb-3 grid h-11 grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] items-center gap-4 rounded-t-2xl bg-lip px-3.5 pb-3 text-xs text-muted shadow-[inset_0_0_0_1px_var(--color-border)]">
      <div className="flex min-w-0 items-center gap-4">
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
      <div className="flex min-w-0 justify-center">
        <TodoProgress items={todos} />
      </div>
    </div>
  );
}
