"use client";

// 输入框上沿后面的“唇条”：一条灰色小舌，显示当前 Git 分支与工作区（工作区选择从底栏移到这里，功能不变）。
// 不是 Git 仓库时不显示分支；会话开始后工作区锁定，只显示名称。
// 有待办（primus-plan 的计划步骤 / todo）时右侧显示进度与当前步骤，悬停或键盘聚焦显示全部步骤。
import { currentTodo, type TodoItem } from "@primus/protocol";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
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

/** 唇条右侧的计划进度：当前步骤一行，悬停显示全部步骤 */
export function TodoProgress({ items }: { items: readonly TodoItem[] }) {
  const current = currentTodo(items);
  if (!current) return null;
  const done = items.filter((i) => i.status === "completed" || i.status === "skipped").length;
  const list = (
    <div className="flex flex-col gap-1 py-0.5 whitespace-normal">
      <p className="font-medium">
        {t.lip.todoAll} {done}/{items.length}
      </p>
      <ol className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              "flex items-start gap-1.5",
              (item.status === "completed" || item.status === "skipped") &&
                "line-through opacity-70",
              item.status === "in_progress" && "font-medium",
            )}
          >
            <span className="mt-[3px] flex shrink-0">
              <TodoMark status={item.status} />
            </span>
            <span className="min-w-0">{item.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
  return (
    <Tooltip content={list} side="top" align="end" className="max-w-96">
      {/* 按钮只为能被键盘聚焦（聚焦同样显示全部步骤），点击没有动作 */}
      <button
        type="button"
        aria-label={`${t.lip.todo} ${done}/${items.length}：${current.text}`}
        className="lip-item-in ml-auto flex min-w-0 cursor-default items-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Icon name="list-check" size="sm" />
        <span className="shrink-0 tabular-nums">
          {done}/{items.length}
        </span>
        <span className="max-w-64 truncate text-fg/80">{current.text}</span>
      </button>
    </Tooltip>
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
    <div className="composer-lip mx-3.5 -mb-3 flex h-11 items-center gap-4 rounded-t-2xl bg-lip px-3.5 pb-3 text-xs text-muted shadow-[inset_0_0_0_1px_var(--color-border)]">
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
      <TodoProgress items={todos} />
    </div>
  );
}
