"use client";

import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import {
  GlassDialog,
  GlassDialogClose,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/ui/glass-dialog";
import {
  GlassPopover,
  GlassPopoverContent,
  GlassPopoverSeparator,
  GlassPopoverTrigger,
} from "@/components/ui/glass-popover";
import { tabsForDeletion, useSessionsStore } from "@/features/sessions/sessions-store";
import { getPlatform, type SessionSummary, type WorkspaceInfo } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";
import {
  Row,
  Section,
  SettingsAlert,
  settingsButtonClass,
  settingsDangerButtonClass,
  settingsInputClass,
} from "./settings-section";

const t = strings.settings.archived;
/** `sessionSearch` 的返回上限（含未归档会话） */
const SEARCH_LIMIT = 50;
const sessionText = strings.sessions;
const actionClass = settingsButtonClass;

export function ArchivedSettings() {
  const router = useRouter();
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState("updated");
  const [project, setProject] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [defaultWorkspace, setDefaultWorkspace] = useState<string | null>(null);
  const [projectSession, setProjectSession] = useState<SessionSummary | null>(null);
  const [projectsFailed, setProjectsFailed] = useState(false);
  useEffect(() => {
    let active = true;
    getPlatform()
      .then(async (platform) => {
        const [projects, defaultPath] = await Promise.all([
          platform.workspaceList(),
          platform.sessionDefaultWorkspace(),
        ]);
        if (active) {
          setWorkspaces(projects);
          setDefaultWorkspace(defaultPath);
        }
      })
      .catch(() => {
        if (active) setProjectsFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionSummary[] | null>(null);
  const [hasArchivedList, setHasArchivedList] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [searching, setSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  // 已恢复或删除的会话：操作完成前发起、之后才返回的查询可能仍带着它们，写回列表前剔除
  const removedPaths = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      const keyword = query.trim();
      if (!keyword) {
        setTruncated(false);
        try {
          const platform = await getPlatform();
          if (typeof platform.sessionListArchived === "function") {
            setSearching(true);
            const archivedList = await platform.sessionListArchived(project || null);
            if (active) {
              setHasArchivedList(true);
              setResults(
                archivedList.filter(
                  (session) => session.archived && !removedPaths.current.has(session.path),
                ),
              );
            }
          } else if (active) {
            setResults(null);
          }
        } catch {
          if (active) setResults(null);
        } finally {
          if (active) setSearching(false);
        }
        return;
      }
      setResults(null);
      setSearching(true);
      setError("");
      setNotice("");
      try {
        const platform = await getPlatform();
        // 选了项目时交给接口在截断前按工作区筛选；接口无归档筛选与分页，命中上限时提示细化关键词
        const matches = await platform.sessionSearch(project || null, keyword);
        if (active) {
          setTruncated(matches.length >= SEARCH_LIMIT);
          setResults(
            matches.filter(
              (session) => session.archived && !removedPaths.current.has(session.path),
            ),
          );
        }
      } catch {
        if (active) setError(sessionText.searchFailed);
      } finally {
        if (active) setSearching(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, project]);

  async function changeSession(session: SessionSummary, remove: boolean) {
    if (busy || searching) return;
    setBusy(true);
    setPendingDelete(null);
    setNotice("");
    setError("");
    try {
      const platform = await getPlatform();
      if (remove) {
        const store = useSessionsStore.getState();
        for (const tab of tabsForDeletion(store.tabs, session)) store.closeTab(tab.id);
        await platform.sessionDelete(session.path);
      } else {
        await platform.sessionArchive(session.path, false);
      }
      removedPaths.current.add(session.path);
      setResults((current) => current?.filter((item) => item.path !== session.path) ?? null);
      setNotice(remove ? t.deleted : t.restored);
    } catch {
      setError(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  const projectNames = new Map(workspaces.map((workspace) => [workspace.path, workspace.name]));
  for (const session of results ?? []) {
    if (session.workspace !== defaultWorkspace && !projectNames.has(session.workspace)) {
      projectNames.set(
        session.workspace,
        session.workspace.split(/[\\/]/).filter(Boolean).at(-1) || session.workspace,
      );
    }
  }

  const visible = results
    ?.filter((session) => !project || session.workspace === project)
    .sort((first, second) => {
      if (sort === "alphabetical") {
        return (
          (first.name || first.title || sessionText.untitled).localeCompare(
            second.name || second.title || sessionText.untitled,
            "zh-CN",
          ) || first.path.localeCompare(second.path)
        );
      }
      return (
        (sort === "created"
          ? second.createdAt - first.createdAt
          : second.updatedAt - first.updatedAt) || first.path.localeCompare(second.path)
      );
    });
  const menuItemClass =
    "relative mx-2 flex cursor-default select-none items-center rounded-[10px] py-2 pl-8 pr-3 text-sm outline-none transition-colors data-[highlighted]:bg-black/8 data-[disabled]:text-muted dark:data-[highlighted]:bg-white/12";
  const triggerClass = cn(settingsButtonClass, "h-9 px-3 font-normal data-[state=open]:bg-hover");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex min-w-48 flex-1 items-center">
          <Icon
            name="search"
            size="sm"
            className="pointer-events-none absolute left-3 text-muted"
          />
          <input
            type="search"
            aria-label={t.search}
            placeholder={t.search}
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.currentTarget.value)}
            className={cn(settingsInputClass, "h-9 pl-9", query && "pr-8")}
          />
          {query && !busy && (
            <button
              type="button"
              aria-label={t.clearSearch}
              onClick={() => setQuery("")}
              className="absolute right-1.5 inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <Icon name="x" size="xs" />
            </button>
          )}
        </div>

        <GlassPopover>
          <GlassPopoverTrigger asChild>
            <button type="button" className={triggerClass}>
              <Icon name="filter" size="sm" className="text-muted" />
              {kind === "local" ? t.local : t.allChats}
              <Icon name="chevron-down" size="xs" className="text-muted" />
            </button>
          </GlassPopoverTrigger>
          <GlassPopoverContent align="end" tint={0.78}>
            <DropdownMenu.Label className="px-5 py-1 text-xs text-muted">
              {t.type}
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={kind} onValueChange={setKind}>
              {(
                [
                  ["all", t.allChats],
                  ["local", t.local],
                  ["cloud", t.cloud],
                ] as const
              ).map(([value, label]) => (
                <DropdownMenu.RadioItem
                  key={value}
                  value={value}
                  disabled={value === "cloud"}
                  className={menuItemClass}
                >
                  <DropdownMenu.ItemIndicator className="absolute left-2">
                    <Icon name="check" size="sm" />
                  </DropdownMenu.ItemIndicator>
                  {label}
                  {value === "cloud" && <span className="ml-2 text-xs">{t.unavailable}</span>}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <GlassPopoverSeparator />
            <DropdownMenu.Label className="px-5 py-1 text-xs text-muted">
              {t.sort}
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={sort} onValueChange={setSort}>
              {(
                [
                  ["updated", t.updated],
                  ["created", t.created],
                  ["alphabetical", t.alphabetical],
                ] as const
              ).map(([value, label]) => (
                <DropdownMenu.RadioItem key={value} value={value} className={menuItemClass}>
                  <DropdownMenu.ItemIndicator className="absolute left-2">
                    <Icon name="check" size="sm" />
                  </DropdownMenu.ItemIndicator>
                  {label}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </GlassPopoverContent>
        </GlassPopover>
        <GlassPopover>
          <GlassPopoverTrigger asChild>
            <button type="button" className={triggerClass}>
              <Icon name="folder" size="sm" className="text-muted" />
              {!project
                ? t.allProjects
                : project === defaultWorkspace
                  ? t.chats
                  : projectNames.get(project) || project}
              <Icon name="chevron-down" size="xs" className="text-muted" />
            </button>
          </GlassPopoverTrigger>
          <GlassPopoverContent align="end" tint={0.78}>
            <DropdownMenu.RadioGroup value={project} onValueChange={setProject}>
              <DropdownMenu.RadioItem value="" className={menuItemClass}>
                <DropdownMenu.ItemIndicator className="absolute left-2">
                  <Icon name="check" size="sm" />
                </DropdownMenu.ItemIndicator>
                {t.allProjects}
              </DropdownMenu.RadioItem>
              <GlassPopoverSeparator />
              {Array.from(
                projectNames,
                ([path, name]) =>
                  path !== defaultWorkspace && (
                    <DropdownMenu.RadioItem key={path} value={path} className={menuItemClass}>
                      <DropdownMenu.ItemIndicator className="absolute left-2">
                        <Icon name="check" size="sm" />
                      </DropdownMenu.ItemIndicator>
                      {name}
                    </DropdownMenu.RadioItem>
                  ),
              )}
              <GlassPopoverSeparator />
              <DropdownMenu.RadioItem
                value={defaultWorkspace ?? "__unavailable__"}
                disabled={!defaultWorkspace}
                className={menuItemClass}
              >
                <DropdownMenu.ItemIndicator className="absolute left-2">
                  <Icon name="check" size="sm" />
                </DropdownMenu.ItemIndicator>
                {t.chats}
              </DropdownMenu.RadioItem>
            </DropdownMenu.RadioGroup>
          </GlassPopoverContent>
        </GlassPopover>
      </div>
      {projectsFailed && (
        <p role="status" className="px-1 text-xs text-muted">
          {t.projectsFailed}
        </p>
      )}

      {error && <SettingsAlert message={error} />}
      {notice && <SettingsAlert tone="neutral" role="status" message={notice} />}
      {searching && results === null && (
        <div
          role="status"
          className="settings-card flex items-center justify-center gap-2 rounded-2xl px-4 py-10 text-sm text-muted"
        >
          <Icon name="loader" size="sm" className="session-spinner shrink-0" />
          <span>{sessionText.searching}</span>
        </div>
      )}
      {truncated && results !== null && (
        <p role="status" className="px-1 text-xs text-muted">
          {t.truncated}
        </p>
      )}
      {!searching && results === null && (
        <div className="settings-card flex flex-col items-center gap-2 rounded-2xl px-6 py-10 text-center">
          <span className="grid size-10 place-items-center rounded-xl bg-black/[0.045] text-muted dark:bg-white/[0.06]">
            <Icon name="archive" size="md" />
          </span>
          <p className="text-sm font-medium text-fg">{t.searchPromptTitle}</p>
          <p className="max-w-md text-xs leading-relaxed text-muted">{t.hint}</p>
        </div>
      )}
      {!searching && visible?.length === 0 && (
        <div className="settings-card flex flex-col items-center gap-2 rounded-2xl px-6 py-10 text-center">
          <span className="grid size-10 place-items-center rounded-xl bg-black/[0.045] text-muted dark:bg-white/[0.06]">
            <Icon name={query.trim() ? "search" : "archive"} size="md" />
          </span>
          <p className="text-sm text-muted">
            {query.trim() || !hasArchivedList ? t.empty : t.emptyList}
          </p>
          <p className="max-w-md text-xs text-muted/80">
            {query.trim() || !hasArchivedList ? t.hint : t.emptyListHint}
          </p>
        </div>
      )}
      {Boolean(visible?.length) && (
        <Section title={strings.settings.groups.archived}>
          {visible?.map((session) => {
            const title = session.name || session.title || sessionText.untitled;
            return (
              <Row
                key={session.path}
                interactive
                label={title}
                hint={
                  session.workspace === defaultWorkspace
                    ? t.standaloneChats
                    : projectNames.get(session.workspace) || session.workspace
                }
              >
                <div className="flex flex-wrap justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={busy || searching}
                    className={actionClass}
                    onClick={() => {
                      if (useSessionsStore.getState().openSession(session)) router.push("/");
                      else setError(sessionText.tabsFull);
                    }}
                  >
                    {t.open}
                  </button>
                  <button
                    type="button"
                    className={actionClass}
                    onClick={() => setProjectSession(session)}
                  >
                    {t.project}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={actionClass}
                    onClick={() => void changeSession(session, false)}
                  >
                    <Icon name="archive-restore" size="xs" />
                    {t.restore}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={settingsDangerButtonClass}
                    onClick={() => setPendingDelete(session)}
                  >
                    {sessionText.delete}
                  </button>
                </div>
              </Row>
            );
          })}
        </Section>
      )}

      <GlassDialog
        open={projectSession !== null}
        onOpenChange={(open) => !open && setProjectSession(null)}
      >
        <GlassDialogContent>
          <GlassDialogTitle>{t.project}</GlassDialogTitle>
          <GlassDialogDescription>
            {projectSession?.workspace === defaultWorkspace
              ? t.standaloneChats
              : projectNames.get(projectSession?.workspace ?? "") || t.project}
          </GlassDialogDescription>
          <p className="mt-3 rounded-lg bg-black/[0.04] px-3 py-2 font-mono text-xs break-all text-muted dark:bg-white/[0.06]">
            {projectSession?.workspace}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            {projectSession?.workspace && (
              <button
                type="button"
                className={actionClass}
                onClick={() => {
                  const target = projectSession.workspace;
                  void getPlatform()
                    .then((p) => p.revealPath?.(target))
                    .catch(() => {});
                }}
              >
                <Icon name="folder-open" size="xs" />
                {t.revealFolder}
              </button>
            )}
            <GlassDialogClose asChild>
              <button type="button" className={actionClass}>
                {sessionText.cancel}
              </button>
            </GlassDialogClose>
          </div>
        </GlassDialogContent>
      </GlassDialog>
      <GlassDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <GlassDialogContent>
          <GlassDialogTitle>{sessionText.deleteTitle}</GlassDialogTitle>
          <GlassDialogDescription>{sessionText.deleteDescription}</GlassDialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <GlassDialogClose asChild>
              <button type="button" className={actionClass}>
                {sessionText.cancel}
              </button>
            </GlassDialogClose>
            <button
              type="button"
              className={settingsDangerButtonClass}
              onClick={() => pendingDelete && void changeSession(pendingDelete, true)}
            >
              {sessionText.deleteConfirm}
            </button>
          </div>
        </GlassDialogContent>
      </GlassDialog>
    </div>
  );
}
