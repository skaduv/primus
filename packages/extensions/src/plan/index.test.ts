import {
  ASK_USER_TOOL,
  ASK_WIDGET,
  PLAN_COMMAND,
  PLAN_SUBMIT_TOOL,
  PLAN_WIDGET,
  type PlanDoc,
  TODO_TOOL,
  TODO_WIDGET,
} from "@primus/protocol";
import { describe, expect, it, vi } from "vitest";
import { createPlanGate } from "./gate.ts";
import { CONTEXT_TYPE, createPlan, ENTRY_TYPE, normalizePlan } from "./index.ts";
import { REMINDER_EXIT, REMINDER_FULL, REMINDER_REENTRY, REMINDER_SPARSE } from "./prompts.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
type Tool = {
  execute: (
    id: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{
    content: { text: string }[];
    details?: Record<string, unknown>;
    isError?: boolean;
    terminate?: boolean;
  }>;
};

function setup(entries: { type: string; customType?: string; data?: unknown }[] = []) {
  const gate = createPlanGate();
  const written: Record<string, string> = {};
  const plan = createPlan({
    gate,
    plansDir: "/data/core/plans",
    writeFile: (p, t) => {
      written[p] = t;
    },
  });
  const handlers: Record<string, Handler> = {};
  const commands: Record<string, (args: string, ctx: unknown) => Promise<void>> = {};
  const tools: Record<string, Tool> = {};
  const appended: unknown[] = [];
  plan.register({
    on: (name: string, h: Handler) => {
      handlers[name] = h;
    },
    registerCommand: (name: string, o: { handler: (a: string, c: unknown) => Promise<void> }) => {
      commands[name] = o.handler;
    },
    registerTool: (t: Tool & { name: string }) => {
      tools[t.name] = t;
    },
    appendEntry: (type: string, data: unknown) => {
      appended.push({ type, data: structuredClone(data) });
      entries.push({ type: "custom", customType: type, data: structuredClone(data) });
    },
  });
  const ctx = {
    hasUI: true,
    cwd: "/w",
    ui: {
      setWidget: vi.fn(),
      notify: vi.fn(),
      select: vi.fn(async (): Promise<string | undefined> => undefined),
      input: vi.fn(async (): Promise<string | undefined> => undefined),
    },
    sessionManager: { getSessionId: () => "s1", getBranch: () => entries },
  };
  const cmd = (args: string) => commands[PLAN_COMMAND]?.(args, ctx);
  const userTurn = () =>
    handlers.before_agent_start?.({ messageType: "user", prompt: "x" }, ctx) as
      | { message: { customType: string; content: string; display: boolean } }
      | undefined;
  const lastWidget = (key: string) => {
    const calls = ctx.ui.setWidget.mock.calls.filter((c) => c[0] === key);
    const lines = calls.at(-1)?.[1] as string[] | undefined;
    return lines ? JSON.parse(lines[0] as string).data : undefined;
  };
  return { plan, gate, handlers, cmd, tools, ctx, userTurn, lastWidget, written, appended };
}

const PLAN: PlanDoc = {
  title: "加计划模式",
  summary: "让用户先审阅计划",
  steps: [
    { id: "1", title: "协议类型", files: ["packages/protocol/src/primus-data.ts"] },
    { id: "2", title: "扩展", detail: "状态机" },
  ],
  verification: ["pnpm test"],
};

describe("primus-plan", () => {
  it("注册命令与三个工具，工具都声明只读、不联网", () => {
    const { tools } = setup();
    expect(Object.keys(tools).sort()).toEqual([ASK_USER_TOOL, PLAN_SUBMIT_TOOL, TODO_TOOL].sort());
  });

  it("/primus-plan on|off 切换阶段、同步只读开关并推 primus:plan", async () => {
    const { cmd, gate, lastWidget, plan } = setup();
    await cmd("on");
    expect(plan.state.phase).toBe("planning");
    expect(gate.readOnly).toBe(true);
    expect(lastWidget(PLAN_WIDGET)).toMatchObject({ phase: "planning" });
    await cmd("off");
    expect(gate.readOnly).toBe(false);
    expect(lastWidget(PLAN_WIDGET)).toMatchObject({ phase: "off" });
  });

  it("提醒节奏：进入后第一回合全文，之后每 5 回合一次，5 次中第 1 次全文；Core 自己发起的回合不注入", async () => {
    const { cmd, userTurn, handlers, ctx } = setup();
    await cmd("on");
    const first = userTurn();
    expect(first?.message).toMatchObject({ customType: CONTEXT_TYPE, display: false });
    expect(first?.message.content).toBe(REMINDER_FULL);
    const seen: (string | undefined)[] = [];
    for (let i = 0; i < 25; i++) seen.push(userTurn()?.message.content);
    const injected = seen.map((s, i) => [i, s] as const).filter(([, s]) => s !== undefined);
    expect(injected.map(([i]) => i)).toEqual([4, 9, 14, 19, 24]);
    expect(injected.map(([, s]) => s)).toEqual([
      REMINDER_SPARSE,
      REMINDER_SPARSE,
      REMINDER_SPARSE,
      REMINDER_SPARSE,
      REMINDER_FULL,
    ]);
    expect(handlers.before_agent_start?.({ messageType: "custom" }, ctx)).toBeUndefined();
    // 压缩后强制全文
    handlers.session_compact?.({}, ctx);
    expect(userTurn()?.message.content).toBe(REMINDER_FULL);
    // 手动退出后注入一次“已退出”
    await cmd("off");
    expect(userTurn()?.message.content).toBe(REMINDER_EXIT);
    expect(userTurn()).toBeUndefined();
  });

  it("不在计划模式时 plan_submit 报错；计划格式不对时报错", async () => {
    const { tools, ctx, cmd } = setup();
    const submit = tools[PLAN_SUBMIT_TOOL] as Tool;
    const r = await submit.execute("t1", PLAN, undefined, undefined, ctx);
    expect(r.isError).toBe(true);
    expect(r.details?.status).toBe("not_planning");
    await cmd("on");
    const bad = await submit.execute("t2", { title: "x", steps: [] }, undefined, undefined, ctx);
    expect(bad.details?.status).toBe("invalid");
  });

  it("提交后阻塞；批准（用户改过计划）后进入执行、预填待办、写计划文件", async () => {
    const { tools, ctx, cmd, plan, gate, lastWidget, written } = setup();
    await cmd("on");
    const running = (tools[PLAN_SUBMIT_TOOL] as Tool).execute("t", PLAN, undefined, undefined, ctx);
    await Promise.resolve();
    expect(plan.state.phase).toBe("awaiting");
    expect(gate.readOnly).toBe(true);
    expect(lastWidget(PLAN_WIDGET)).toMatchObject({ id: "p1", status: "awaiting", plan: PLAN });
    expect(Object.keys(written)).toEqual(["/data/core/plans/s1-p1.md"]);
    const edited = { ...PLAN, steps: [...PLAN.steps, { id: "3", title: "前端" }] };
    await cmd(`approve ${JSON.stringify({ id: "p1", plan: edited, permission: "edit" })}`);
    const r = await running;
    expect(r.isError).toBeUndefined();
    expect(r.details).toMatchObject({ status: "approved", edited: true });
    expect(r.content[0]?.text).toContain("前端");
    expect(plan.state.phase).toBe("executing");
    expect(gate.readOnly).toBe(false);
    expect(lastWidget(TODO_WIDGET).items).toEqual([
      { id: "1", text: "协议类型", status: "in_progress" },
      { id: "2", text: "扩展", status: "pending" },
      { id: "3", text: "前端", status: "pending" },
    ]);
    expect(written["/data/core/plans/s1-p1.md"]).toContain("前端");
  });

  it("继续完善：带反馈返回、回到计划中；取消：结束本轮", async () => {
    const { tools, ctx, cmd, plan } = setup();
    await cmd("on");
    const submit = tools[PLAN_SUBMIT_TOOL] as Tool;
    const p1 = submit.execute("t", PLAN, undefined, undefined, ctx);
    await Promise.resolve();
    await cmd(`revise ${JSON.stringify({ id: "p1", feedback: "再加测试" })}`);
    const r1 = await p1;
    expect(r1.isError).toBe(true);
    expect(r1.content[0]?.text).toContain("再加测试");
    expect(plan.state.phase).toBe("planning");

    const ac = new AbortController();
    const p2 = submit.execute("t", PLAN, ac.signal, undefined, ctx);
    await Promise.resolve();
    expect(plan.state.id).toBe("p2");
    ac.abort();
    const r2 = await p2;
    expect(r2).toMatchObject({ isError: true, terminate: true });
    expect(plan.state.status).toBe("cancelled");

    // 等待审批时关闭计划模式：按取消返回
    const p3 = submit.execute("t", PLAN, undefined, undefined, ctx);
    await Promise.resolve();
    await cmd("off");
    expect((await p3).details?.status).toBe("cancelled");
    expect(plan.state.phase).toBe("off");
  });

  it("没有等待审批的计划时 approve 只提示", async () => {
    const { cmd, ctx } = setup();
    await cmd(`approve ${JSON.stringify({ id: "p9" })}`);
    expect(ctx.ui.notify).toHaveBeenCalled();
    await cmd("approve {坏 json");
    expect(ctx.ui.notify).toHaveBeenCalledTimes(2);
  });

  it("todo：计划中不可用；最多一个进行中；执行阶段全部完成后退出", async () => {
    const { tools, ctx, cmd, plan, lastWidget } = setup();
    const todo = tools[TODO_TOOL] as Tool;
    await cmd("on");
    expect((await todo.execute("t", { items: [] }, undefined, undefined, ctx)).isError).toBe(true);
    const submit = (tools[PLAN_SUBMIT_TOOL] as Tool).execute("t", PLAN, undefined, undefined, ctx);
    await Promise.resolve();
    await cmd(`approve ${JSON.stringify({ id: "p1" })}`);
    await submit;
    const two = await todo.execute(
      "t",
      {
        items: [
          { id: "1", text: "a", status: "in_progress" },
          { id: "2", text: "b", status: "in_progress" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    expect(two.isError).toBe(true);
    await todo.execute(
      "t",
      {
        items: [
          { id: "1", text: "a", status: "completed" },
          { id: "2", text: "b", status: "skipped" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    expect(plan.state.phase).toBe("off");
    expect(lastWidget(TODO_WIDGET).items).toHaveLength(2);
  });

  it("执行计划：连续几个回合不更新待办就插隐藏提醒；准备结束时还没更新过就提醒并再请求一次", async () => {
    const { tools, ctx, cmd, handlers } = setup();
    await cmd("on");
    const submit = (tools[PLAN_SUBMIT_TOOL] as Tool).execute("t", PLAN, undefined, undefined, ctx);
    await Promise.resolve();
    await cmd(`approve ${JSON.stringify({ id: "p1" })}`);
    await submit;
    handlers.agent_start?.({}, ctx);
    const turn = (toolName?: string) =>
      handlers.turn_end?.({ toolResults: toolName ? [{ toolName }] : [] }, ctx) as
        | { entries: { type: string; customType: string; content: string; display: boolean }[] }
        | undefined;
    expect(turn("bash")).toBeUndefined();
    expect(turn("edit")).toBeUndefined();
    const nudge = turn("read");
    expect(nudge?.entries[0]).toMatchObject({
      type: "custom_message",
      customType: CONTEXT_TYPE,
      display: false,
    });
    expect(nudge?.entries[0]?.content).toContain("[in_progress] 1. 协议类型");
    // 没有工具调用的回合（最后的回答）不计数
    expect(turn()).toBeUndefined();
    const settle = (outcome = "completed") =>
      handlers.agent_before_settle?.({ outcome, context: { canContinue: true } }, ctx) as
        | { entries: unknown[]; continue: boolean }
        | undefined;
    expect(settle("aborted")).toBeUndefined();
    expect(settle()?.continue).toBe(true);
    // 每轮只提醒一次
    expect(settle()).toBeUndefined();
    // 这一轮调用过 todo：结束前不再提醒
    handlers.agent_start?.({}, ctx);
    expect(turn(TODO_TOOL)).toBeUndefined();
    expect(settle()).toBeUndefined();
  });

  it("ask_user：推 primus:ask 等回答，选项或自己写的想法都能回；关闭提问时停下", async () => {
    const { tools, ctx, cmd, lastWidget } = setup();
    const ask = tools[ASK_USER_TOOL] as Tool;
    const questions = [
      {
        id: "auth",
        header: "认证",
        question: "用哪种认证？",
        options: [{ label: "JWT", description: "无状态" }, { label: "Session" }],
      },
      { id: "cache", question: "缓存？", options: [{ label: "内存" }, { label: "无" }] },
    ];
    const pending = ask.execute("t", { questions }, undefined, undefined, ctx);
    await Promise.resolve();
    expect(lastWidget(ASK_WIDGET)).toEqual({
      id: "a1",
      questions: [
        {
          ...questions[0],
          options: [{ label: "JWT", description: "无状态" }, { label: "Session" }],
        },
        questions[1],
      ],
    });
    await cmd(
      `answer ${JSON.stringify({ id: "a1", answers: { auth: { selected: "JWT" }, cache: { other: " 用 Redis " } } })}`,
    );
    const r = await pending;
    expect(JSON.parse(r.content[0]?.text ?? "")).toEqual({
      answers: { auth: { selected: "JWT" }, cache: { other: "用 Redis" } },
    });
    // 回答后清除提问卡片
    expect(ctx.ui.setWidget.mock.calls.at(-1)).toEqual([ASK_WIDGET, undefined]);
    const second = ask.execute("t", { questions: [questions[1]] }, undefined, undefined, ctx);
    await Promise.resolve();
    await cmd(`answer ${JSON.stringify({ id: "a2", cancel: true })}`);
    const cancelled = await second;
    expect(cancelled.isError).toBe(true);
    expect(cancelled.terminate).toBe(true);
    // 没有等待中的提问：提示一下，不报错
    await cmd(`answer ${JSON.stringify({ id: "a9", answers: { x: { selected: "1" } } })}`);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("没有等待回答的问题", "warning");
  });

  it("ask_user：规划中提问时关闭计划模式，提问作废、卡片收起", async () => {
    const { tools, ctx, cmd } = setup();
    const ask = tools[ASK_USER_TOOL] as Tool;
    await cmd("on");
    const q = [{ id: "x", question: "选哪个？", options: [{ label: "A" }, { label: "B" }] }];
    const pending = ask.execute("t", { questions: q }, undefined, undefined, ctx);
    await Promise.resolve();
    await cmd("off");
    const r = await pending;
    expect(r.isError).toBe(true);
    expect(r.terminate).toBe(true);
    expect(ctx.ui.setWidget.mock.calls.at(-1)).toEqual([ASK_WIDGET, undefined]);
  });

  it("ask_user：没有 setWidget 时逐题 select，“其他”转文本输入；没有界面时报错", async () => {
    const { tools, ctx } = setup();
    const ask = tools[ASK_USER_TOOL] as Tool;
    const noWidget = { ...ctx, ui: { ...ctx.ui, setWidget: undefined } };
    ctx.ui.select.mockResolvedValueOnce("JWT：无状态").mockResolvedValueOnce("其他（自己填写）");
    ctx.ui.input.mockResolvedValueOnce("用 Redis");
    const r = await ask.execute(
      "t",
      {
        questions: [
          {
            id: "auth",
            header: "认证",
            question: "用哪种认证？",
            options: [{ label: "JWT", description: "无状态" }, { label: "Session" }],
          },
          { id: "cache", question: "缓存？", options: [{ label: "内存" }, { label: "无" }] },
        ],
      },
      undefined,
      undefined,
      noWidget,
    );
    expect(JSON.parse(r.content[0]?.text ?? "")).toEqual({
      answers: { auth: { selected: "JWT" }, cache: { other: "用 Redis" } },
    });
    expect(ctx.ui.select.mock.calls[0]?.[0]).toBe("认证｜用哪种认证？");
    const noUi = await ask.execute(
      "t",
      { questions: [{ id: "a", question: "q", options: [{ label: "1" }, { label: "2" }] }] },
      undefined,
      undefined,
      { ...ctx, hasUI: false },
    );
    expect(noUi.isError).toBe(true);
  });

  it("恢复会话：从最后一条记录还原；等待审批的降回计划中；再次进入时先提示重新进入", async () => {
    const entries: { type: string; customType?: string; data?: unknown }[] = [];
    const a = setup(entries);
    await a.cmd("on");
    void (a.tools[PLAN_SUBMIT_TOOL] as Tool).execute("t", PLAN, undefined, undefined, a.ctx);
    await Promise.resolve();
    expect(entries.at(-1)).toMatchObject({ customType: ENTRY_TYPE });

    const b = setup(entries);
    b.handlers.session_start?.({ reason: "resume" }, b.ctx);
    expect(b.plan.state).toMatchObject({ phase: "planning", status: "cancelled", id: "p1" });
    expect(b.gate.readOnly).toBe(true);
    expect(b.userTurn()?.message.content).toBe(REMINDER_FULL);
    await b.cmd("off");
    await b.cmd("on");
    expect(b.userTurn()?.message.content).toBe(`${REMINDER_REENTRY}\n\n${REMINDER_FULL}`);
  });

  it("同一进程里会话重新开始：等待中的 plan_submit 返回取消，且不改写新会话的状态", async () => {
    const entries: { type: string; customType?: string; data?: unknown }[] = [];
    const a = setup(entries);
    await a.cmd("on");
    const pending = (a.tools[PLAN_SUBMIT_TOOL] as Tool).execute(
      "t",
      PLAN,
      undefined,
      undefined,
      a.ctx,
    );
    await Promise.resolve();
    const before = entries.length;
    a.handlers.session_start?.(
      { reason: "new" },
      { ...a.ctx, sessionManager: { getBranch: () => [] } },
    );
    const r = await pending;
    expect(r.details).toMatchObject({ status: "cancelled" });
    expect(r.terminate).toBe(true);
    expect(a.plan.state.phase).toBe("off");
    expect(entries.length).toBe(before);
  });

  it("normalizePlan 去掉空白项、补步骤编号", () => {
    const p = normalizePlan({
      title: " t ",
      summary: "s",
      steps: [{ title: "a", files: ["", "x"] }],
      verification: ["v", " "],
      risks: [],
    });
    expect(p).toEqual({
      title: "t",
      summary: "s",
      steps: [{ id: "1", title: "a", files: ["x"] }],
      verification: ["v"],
    });
  });
});
