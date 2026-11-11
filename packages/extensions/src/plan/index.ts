// primus-plan：计划模式与待办（技术方案第 14.2、14.3 节）。
//
// 状态：off → planning（只读）→ awaiting（plan_submit 阻塞等审批）→ executing（按待办执行）→ off。
// - 只读约束由 primus-guard 执行（见 gate.ts）；工具列表全程不变（不用 setActiveTools，保护提示缓存）。
// - 提示：before_agent_start 注入隐藏消息。进入后第一个用户回合注入全文，之后每满 5 个用户回合一次，
//   5 次中第 1 次全文、其余一行；压缩、恢复会话、计划被打回后下一次强制全文；退出后注入一次“已退出”。
//   Core 自己发起的回合（messageType 不是 user）不注入、不改变模式。
// - plan_submit：结构化计划，推 primus:plan 给前端，阻塞到 `/primus-plan approve|revise`、关闭计划模式或用户停止。
// - todo：完整清单整体替换，推 primus:todo；计划中不可用；批准计划时按步骤预填。
// - ask_user：选择题，v1 逐题复用 select / input 对话框。
// - 状态经 appendEntry("primus-plan") 持久化，session_start 时恢复；计划 Markdown 写到 <Core 目录>/plans/。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASK_USER_TOOL,
  normalizeTodoItems,
  PLAN_COMMAND,
  PLAN_SUBMIT_TOOL,
  PLAN_WIDGET,
  type PlanApproveArgs,
  type PlanApprovePermission,
  type PlanData,
  type PlanDoc,
  type PlanPhase,
  type PlanReviseArgs,
  type PlanStatus,
  type PlanSubmitDetails,
  planToMarkdown,
  TODO_TOOL,
  TODO_WIDGET,
  type TodoItem,
} from "@primus/protocol";
import { type PlanGate, planGate } from "./gate.ts";
import {
  REMINDER_EXIT,
  REMINDER_FULL,
  REMINDER_REENTRY,
  REMINDER_SPARSE,
  TEXT,
} from "./prompts.ts";

/** 两次提醒之间的用户回合数；每这么多次提醒里第一次是全文（与 Claude Code 的节奏一致） */
export const TURNS_BETWEEN_REMINDERS = 5;
export const FULL_REMINDER_EVERY = 5;
export const ENTRY_TYPE = "primus-plan";
export const CONTEXT_TYPE = "primus-plan-context";
/** 计划渲染成 Markdown 后的上限（字符） */
const MAX_PLAN_CHARS = 60_000;
const MAX_STEPS = 30;

export interface PersistedPlan {
  v: 1;
  phase: PlanPhase;
  /** 已提交过几次计划（计划 ID 为 p1、p2…） */
  count: number;
  id?: string;
  status?: PlanStatus;
  plan?: PlanDoc;
  path?: string;
  todos: TodoItem[];
  /** 本次计划期内已注入的提醒次数 */
  reminders: number;
  /** 距上一次提醒的用户回合数 */
  turnsSince: number;
  /** 下一次提醒强制用全文 */
  forceFull: boolean;
  /** 下一个用户回合注入“已退出计划模式” */
  exitNotice: boolean;
  /** 本会话之前退出过计划模式（再次进入时注入“重新进入”提示） */
  exitedOnce: boolean;
}

export const initialPlanState = (): PersistedPlan => ({
  v: 1,
  phase: "off",
  count: 0,
  todos: [],
  reminders: 0,
  turnsSince: 0,
  forceFull: false,
  exitNotice: false,
  exitedOnce: false,
});

type Decision =
  | { kind: "approve"; plan?: PlanDoc; permission: PlanApprovePermission }
  | { kind: "revise"; feedback: string }
  | { kind: "cancel" };

// ---------- 扩展 API 中用到的部分（类型不从上游包导入，见 AGENTS.md 第 2.2 节） ----------

interface Ui {
  select?: (
    title: string,
    options: string[],
    opts?: { signal?: AbortSignal },
  ) => Promise<string | undefined>;
  input?: (
    title: string,
    placeholder?: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<string | undefined>;
  setWidget?: (key: string, lines: string[] | undefined) => void;
  notify?: (message: string, type?: "info" | "warning" | "error") => void;
}
export interface PlanContext {
  hasUI?: boolean;
  cwd?: string;
  ui?: Ui;
  sessionManager?: {
    getSessionId?: () => string;
    getBranch?: () => { type: string; customType?: string; data?: unknown }[];
    getEntries?: () => { type: string; customType?: string; data?: unknown }[];
  };
}
interface ToolResult {
  content: { type: "text"; text: string }[];
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}
interface ToolDef {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  annotations?: { readOnlyHint?: boolean; openWorldHint?: boolean };
  executionMode?: "sequential" | "parallel";
  execute: (
    toolCallId: string,
    params: never,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: PlanContext,
  ) => Promise<ToolResult>;
}
interface PlanApi {
  on: (event: string, handler: (event: never, ctx: PlanContext) => unknown) => void;
  registerCommand: (
    name: string,
    options: { description: string; handler: (args: string, ctx: PlanContext) => Promise<void> },
  ) => void;
  registerTool: (tool: ToolDef) => void;
  appendEntry?: (customType: string, data?: unknown) => void;
}

function isPlanApi(pi: unknown): pi is PlanApi {
  const p = pi as Partial<PlanApi> | null;
  return (
    typeof p?.on === "function" &&
    typeof p.registerCommand === "function" &&
    typeof p.registerTool === "function"
  );
}

// ---------- 参数（JSON Schema；Core 对非 TypeBox 的 schema 按 JSON Schema 校验） ----------

const str = (description: string) => ({ type: "string", description }) as const;
const strList = (description: string) =>
  ({ type: "array", items: { type: "string" }, description }) as const;
const P = TEXT.planSubmit.params;

export const PLAN_SUBMIT_PARAMETERS = {
  type: "object",
  properties: {
    title: str(P.title),
    summary: str(P.summary),
    steps: {
      type: "array",
      description: P.steps,
      items: {
        type: "object",
        properties: {
          id: str(P.stepId),
          title: str(P.stepTitle),
          detail: str(P.stepDetail),
          files: strList(P.stepFiles),
        },
        required: ["id", "title"],
      },
    },
    risks: strList(P.risks),
    verification: strList(P.verification),
    assumptions: strList(P.assumptions),
  },
  required: ["title", "summary", "steps", "verification"],
} as const;

const T = TEXT.todo.params;
export const TODO_PARAMETERS = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description: T.items,
      items: {
        type: "object",
        properties: {
          id: str(T.id),
          text: str(T.text),
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "skipped"],
            description: T.status,
          },
        },
        required: ["id", "text", "status"],
      },
    },
  },
  required: ["items"],
} as const;

const A = TEXT.askUser.params;
export const ASK_USER_PARAMETERS = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      description: A.questions,
      items: {
        type: "object",
        properties: {
          id: str(A.id),
          header: str(A.header),
          question: str(A.question),
          options: {
            type: "array",
            description: A.options,
            items: {
              type: "object",
              properties: { label: str(A.label), description: str(A.description) },
              required: ["label"],
            },
          },
        },
        required: ["id", "question", "options"],
      },
    },
  },
  required: ["questions"],
} as const;

// ---------- 校验 ----------

const cleanList = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((s): s is string => typeof s === "string" && s.trim() !== "");
  return out.length ? out.map((s) => s.trim()) : undefined;
};

/** 校验并规范化一份计划；不合法时返回原因 */
export function normalizePlan(raw: unknown): PlanDoc | string {
  const p = raw as Partial<PlanDoc> | null;
  if (!p || typeof p !== "object") return "计划不是对象";
  if (typeof p.title !== "string" || !p.title.trim()) return "缺少标题 title";
  if (typeof p.summary !== "string" || !p.summary.trim()) return "缺少概述 summary";
  if (!Array.isArray(p.steps) || p.steps.length === 0) return "至少需要一个步骤 steps";
  if (p.steps.length > MAX_STEPS) return `步骤不能超过 ${MAX_STEPS} 个`;
  const steps: PlanDoc["steps"] = [];
  for (const [i, s] of p.steps.entries()) {
    if (!s || typeof s.title !== "string" || !s.title.trim()) return `第 ${i + 1} 步缺少 title`;
    const files = cleanList(s.files);
    steps.push({
      id: typeof s.id === "string" && s.id.trim() ? s.id.trim() : String(i + 1),
      title: s.title.trim(),
      ...(typeof s.detail === "string" && s.detail.trim() ? { detail: s.detail.trim() } : {}),
      ...(files ? { files } : {}),
    });
  }
  const verification = cleanList(p.verification);
  if (!verification) return "缺少验证方式 verification";
  const risks = cleanList(p.risks);
  const assumptions = cleanList(p.assumptions);
  const plan: PlanDoc = {
    title: p.title.trim(),
    summary: p.summary.trim(),
    steps,
    verification,
    ...(risks ? { risks } : {}),
    ...(assumptions ? { assumptions } : {}),
  };
  if (planToMarkdown(plan).length > MAX_PLAN_CHARS) return `计划太长（超过 ${MAX_PLAN_CHARS} 字）`;
  return plan;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

// ---------- 扩展 ----------

export interface PlanEnv {
  gate: PlanGate;
  /** 计划文件目录；缺省为 PRIMUS_CODING_AGENT_DIR/plans，没有时不写文件 */
  plansDir?: string | null;
  writeFile?: (path: string, text: string) => void;
}

const defaultWrite = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
};

export function createPlan(env: Partial<PlanEnv> = {}) {
  const gate = env.gate ?? planGate;
  const plansDir =
    env.plansDir === undefined
      ? process.env.PRIMUS_CODING_AGENT_DIR
        ? join(process.env.PRIMUS_CODING_AGENT_DIR, "plans")
        : null
      : env.plansDir;
  const write = env.writeFile ?? defaultWrite;
  let state = initialPlanState();
  /** 等待审批的计划：id → 兑现函数 */
  const pending = new Map<string, (d: Decision) => void>();
  let api: PlanApi | undefined;
  let lastCtx: PlanContext | undefined;

  const readOnlyPhase = (p: PlanPhase) => p === "planning" || p === "awaiting";
  const syncGate = () => {
    gate.readOnly = readOnlyPhase(state.phase);
  };

  function publish(ctx: PlanContext | undefined = lastCtx): void {
    const setWidget = ctx?.ui?.setWidget;
    if (!setWidget) return;
    const data: PlanData = {
      phase: state.phase,
      ...(state.id ? { id: state.id } : {}),
      ...(state.status ? { status: state.status } : {}),
      ...(state.plan ? { plan: state.plan } : {}),
      ...(state.path ? { path: state.path } : {}),
    };
    setWidget(PLAN_WIDGET, [JSON.stringify({ v: 1, type: "plan", data })]);
    setWidget(TODO_WIDGET, [JSON.stringify({ v: 1, type: "todo", data: { items: state.todos } })]);
  }

  function persist(): void {
    try {
      api?.appendEntry?.(ENTRY_TYPE, state);
    } catch {}
  }

  function commit(ctx?: PlanContext): void {
    syncGate();
    persist();
    publish(ctx);
  }

  function enter(): void {
    if (readOnlyPhase(state.phase)) return;
    state.phase = "planning";
    state.reminders = 0;
    state.turnsSince = 0;
    state.forceFull = true;
    state.exitNotice = false;
  }

  function leave(): void {
    if (state.phase === "off") return;
    const wasPlanning = readOnlyPhase(state.phase);
    state.phase = "off";
    if (wasPlanning) {
      state.exitNotice = true;
      state.exitedOnce = true;
    }
    // 等待中的审批按取消处理（工具返回，模型停下）
    for (const resolve of pending.values()) resolve({ kind: "cancel" });
    pending.clear();
    if (state.status === "awaiting") state.status = "cancelled";
  }

  /** 这一轮要注入的提示（只在用户发起的回合调用） */
  function reminderFor(): string | undefined {
    if (readOnlyPhase(state.phase)) {
      const parts: string[] = [];
      if (state.reminders === 0 && state.exitedOnce && state.plan) parts.push(REMINDER_REENTRY);
      let inject = state.forceFull || state.reminders === 0;
      if (!inject) {
        state.turnsSince++;
        inject = state.turnsSince >= TURNS_BETWEEN_REMINDERS;
      }
      if (!inject) return undefined;
      const full = state.forceFull || state.reminders % FULL_REMINDER_EVERY === 0;
      state.reminders++;
      state.turnsSince = 0;
      state.forceFull = false;
      parts.push(full ? REMINDER_FULL : REMINDER_SPARSE);
      return parts.join("\n\n");
    }
    if (state.exitNotice) {
      state.exitNotice = false;
      return REMINDER_EXIT;
    }
    return undefined;
  }

  function restore(ctx: PlanContext): void {
    const sm = ctx.sessionManager;
    const entries = sm?.getBranch?.() ?? sm?.getEntries?.() ?? [];
    let saved: PersistedPlan | undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e?.type === "custom" && e.customType === ENTRY_TYPE) {
        saved = e.data as PersistedPlan;
        break;
      }
    }
    state = initialPlanState();
    if (saved && saved.v === 1) {
      state = {
        ...state,
        ...saved,
        todos: normalizeTodoItems(saved.todos),
      };
      // 恢复时审批已断开：降回计划中，下一次全文提醒
      if (state.phase === "awaiting") {
        state.phase = "planning";
        state.status = "cancelled";
      }
      if (readOnlyPhase(state.phase)) state.forceFull = true;
    }
    pending.clear();
  }

  function writePlanFile(ctx: PlanContext, id: string, plan: PlanDoc): string | undefined {
    if (!plansDir) return undefined;
    const session = ctx.sessionManager?.getSessionId?.() ?? "session";
    const path = join(plansDir, `${session.replace(/[^\w.-]/g, "_")}-${id}.md`);
    try {
      write(path, planToMarkdown(plan));
      return path;
    } catch {
      return undefined;
    }
  }

  function seedTodos(plan: PlanDoc): void {
    state.todos = plan.steps.map((s, i) => ({
      id: s.id,
      text: s.title,
      status: i === 0 ? "in_progress" : "pending",
    }));
  }

  const result = (text: string, details?: unknown, extra: Partial<ToolResult> = {}) => ({
    content: [{ type: "text" as const, text }],
    ...(details === undefined ? {} : { details }),
    ...extra,
  });

  async function submit(
    params: unknown,
    signal: AbortSignal | undefined,
    ctx: PlanContext,
  ): Promise<ToolResult> {
    lastCtx = ctx;
    const t = TEXT.planSubmit;
    if (state.phase !== "planning") {
      const details: PlanSubmitDetails = { id: "", status: "not_planning" };
      return result(t.notPlanning, details, { isError: true });
    }
    const plan = normalizePlan(params);
    if (typeof plan === "string") {
      const details: PlanSubmitDetails = { id: "", status: "invalid" };
      return result(t.invalid(plan), details, { isError: true });
    }
    if (ctx.hasUI !== true || typeof ctx.ui?.setWidget !== "function") {
      const details: PlanSubmitDetails = { id: "", status: "no_ui", plan };
      return result(t.noUi, details, { isError: true });
    }
    state.count++;
    const id = `p${state.count}`;
    state.id = id;
    state.plan = plan;
    state.status = "awaiting";
    state.phase = "awaiting";
    state.path = writePlanFile(ctx, id, plan);
    commit(ctx);

    const decision = await new Promise<Decision>((resolve) => {
      pending.set(id, resolve);
      if (signal?.aborted) resolve({ kind: "cancel" });
      signal?.addEventListener("abort", () => resolve({ kind: "cancel" }), { once: true });
    });
    pending.delete(id);

    if (decision.kind === "approve") {
      const edited = decision.plan !== undefined && !sameJson(decision.plan, plan);
      const final = edited && decision.plan ? decision.plan : plan;
      if (edited) state.path = writePlanFile(ctx, id, final) ?? state.path;
      state.plan = final;
      state.status = "approved";
      state.phase = "executing";
      state.exitedOnce = true;
      seedTodos(final);
      commit(ctx);
      const details: PlanSubmitDetails = {
        id,
        status: "approved",
        plan: final,
        ...(edited ? { edited: true } : {}),
        ...(state.path ? { path: state.path } : {}),
      };
      return result(t.approved(edited, planToMarkdown(final)), details);
    }
    if (decision.kind === "revise") {
      // 用户关闭计划模式与打回同时发生时，以关闭为准
      if (state.phase === "awaiting") state.phase = "planning";
      state.status = "revising";
      state.forceFull = true;
      commit(ctx);
      const details: PlanSubmitDetails = {
        id,
        status: "revising",
        plan,
        feedback: decision.feedback,
      };
      return result(t.revise(decision.feedback), details, { isError: true });
    }
    if (state.phase === "awaiting") state.phase = "planning";
    state.status = "cancelled";
    commit(ctx);
    const details: PlanSubmitDetails = { id, status: "cancelled", plan };
    return result(t.cancelled, details, { isError: true, terminate: true });
  }

  async function todo(params: unknown, ctx: PlanContext): Promise<ToolResult> {
    lastCtx = ctx;
    const t = TEXT.todo;
    if (readOnlyPhase(state.phase)) return result(t.inPlan, undefined, { isError: true });
    const items = normalizeTodoItems((params as { items?: unknown } | null)?.items);
    if (items.filter((i) => i.status === "in_progress").length > 1)
      return result(t.tooManyInProgress, undefined, { isError: true });
    state.todos = items;
    const finished =
      items.length > 0 && items.every((i) => i.status === "completed" || i.status === "skipped");
    if (finished && state.phase === "executing") state.phase = "off";
    commit(ctx);
    const done = items.filter((i) => i.status === "completed").length;
    return result(finished ? t.allDone : t.updated(done, items.length), { items });
  }

  async function askUser(
    params: unknown,
    signal: AbortSignal | undefined,
    ctx: PlanContext,
  ): Promise<ToolResult> {
    const t = TEXT.askUser;
    const raw = (params as { questions?: unknown } | null)?.questions;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 3)
      return result(t.invalid("需要 1–3 个问题"), undefined, { isError: true });
    const select = ctx.ui?.select;
    if (ctx.hasUI !== true || typeof select !== "function")
      return result(t.noUi, undefined, { isError: true });
    const answers: Record<string, { selected: string; other?: string }> = {};
    for (const [i, q] of raw.entries()) {
      const question = q as {
        id?: unknown;
        header?: unknown;
        question?: unknown;
        options?: unknown;
      };
      if (typeof question?.question !== "string" || !question.question.trim())
        return result(t.invalid(`第 ${i + 1} 题缺少 question`), undefined, { isError: true });
      const options = Array.isArray(question.options)
        ? question.options
            .map((o) => (o as { label?: unknown; description?: unknown } | null) ?? {})
            .filter(
              (o): o is { label: string; description?: unknown } =>
                typeof o.label === "string" && o.label.trim() !== "",
            )
        : [];
      if (options.length < 2 || options.length > 4)
        return result(t.invalid(`第 ${i + 1} 题需要 2–4 个选项`), undefined, { isError: true });
      const labels = options.map((o) =>
        typeof o.description === "string" && o.description.trim()
          ? `${o.label.trim()}：${o.description.trim()}`
          : o.label.trim(),
      );
      const header = typeof question.header === "string" && question.header.trim();
      const title = header ? `${header}｜${question.question.trim()}` : question.question.trim();
      const choice = await select(title, [...labels, t.other], { signal });
      if (choice === undefined) return result(t.unanswered, { answers }, { isError: true });
      const id =
        typeof question.id === "string" && question.id.trim() ? question.id.trim() : `q${i + 1}`;
      if (choice === t.other) {
        const text = await ctx.ui?.input?.(title, t.otherPrompt, { signal });
        if (text === undefined) return result(t.unanswered, { answers }, { isError: true });
        answers[id] = { selected: "other", other: text };
      } else {
        const idx = labels.indexOf(choice);
        answers[id] = { selected: options[idx]?.label.trim() ?? choice };
      }
    }
    return result(JSON.stringify({ answers }), { answers });
  }

  async function command(args: string, ctx: PlanContext): Promise<void> {
    lastCtx = ctx;
    const text = args.trim();
    const space = text.indexOf(" ");
    const verb = (space < 0 ? text : text.slice(0, space)).toLowerCase();
    const rest = space < 0 ? "" : text.slice(space + 1).trim();
    const c = TEXT.command;
    switch (verb) {
      case "on":
        enter();
        commit(ctx);
        return;
      case "off":
        leave();
        commit(ctx);
        return;
      case "":
      case "status":
        publish(ctx);
        return;
      case "approve":
      case "revise": {
        const parsed = parseJson<PlanApproveArgs & PlanReviseArgs>(rest);
        if (!parsed || typeof parsed.id !== "string") {
          ctx.ui?.notify?.(c.badJson, "error");
          return;
        }
        const resolve = pending.get(parsed.id);
        if (!resolve) {
          ctx.ui?.notify?.(c.noPending, "warning");
          publish(ctx);
          return;
        }
        if (verb === "approve") {
          let edited: PlanDoc | undefined;
          if (parsed.plan !== undefined) {
            const plan = normalizePlan(parsed.plan);
            if (typeof plan === "string") {
              ctx.ui?.notify?.(TEXT.planSubmit.invalid(plan), "error");
              return;
            }
            edited = plan;
          }
          const permission: PlanApprovePermission =
            parsed.permission === "edit" || parsed.permission === "ask"
              ? parsed.permission
              : "keep";
          resolve({ kind: "approve", ...(edited ? { plan: edited } : {}), permission });
        } else {
          const feedback = typeof parsed.feedback === "string" ? parsed.feedback.trim() : "";
          if (!feedback) {
            ctx.ui?.notify?.(c.badJson, "error");
            return;
          }
          resolve({ kind: "revise", feedback });
        }
        return;
      }
      default:
        ctx.ui?.notify?.(c.unknown(text), "error");
    }
  }

  function register(pi: unknown): void {
    if (!isPlanApi(pi)) return;
    api = pi;
    pi.registerCommand(PLAN_COMMAND, { description: TEXT.command.description, handler: command });

    const ps = TEXT.planSubmit;
    pi.registerTool({
      name: PLAN_SUBMIT_TOOL,
      label: ps.label,
      description: ps.description,
      promptSnippet: ps.snippet,
      promptGuidelines: [...ps.guidelines],
      parameters: PLAN_SUBMIT_PARAMETERS,
      annotations: { readOnlyHint: true, openWorldHint: false },
      executionMode: "sequential",
      execute: (_id, params, signal, _onUpdate, ctx) => submit(params, signal, ctx),
    });
    const td = TEXT.todo;
    pi.registerTool({
      name: TODO_TOOL,
      label: td.label,
      description: td.description,
      promptSnippet: td.snippet,
      promptGuidelines: [...td.guidelines],
      parameters: TODO_PARAMETERS,
      annotations: { readOnlyHint: true, openWorldHint: false },
      execute: (_id, params, _signal, _onUpdate, ctx) => todo(params, ctx),
    });
    const au = TEXT.askUser;
    pi.registerTool({
      name: ASK_USER_TOOL,
      label: au.label,
      description: au.description,
      promptSnippet: au.snippet,
      promptGuidelines: [...au.guidelines],
      parameters: ASK_USER_PARAMETERS,
      annotations: { readOnlyHint: true, openWorldHint: false },
      executionMode: "sequential",
      execute: (_id, params, signal, _onUpdate, ctx) => askUser(params, signal, ctx),
    });

    pi.on("session_start", (_event, ctx) => {
      lastCtx = ctx;
      restore(ctx);
      syncGate();
      publish(ctx);
    });
    pi.on("session_compact", () => {
      if (readOnlyPhase(state.phase)) state.forceFull = true;
    });
    pi.on("before_agent_start", (event: never, ctx) => {
      lastCtx = ctx;
      if ((event as { messageType?: string }).messageType !== "user") return undefined;
      const content = reminderFor();
      if (!content) return undefined;
      persist();
      return { message: { customType: CONTEXT_TYPE, content, display: false } };
    });
  }

  return {
    register,
    /** 测试用：当前状态 */
    get state() {
      return state;
    },
  };
}

export default createPlan().register;
