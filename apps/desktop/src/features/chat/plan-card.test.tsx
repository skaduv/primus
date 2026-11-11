import type { PlanDoc } from "@primus/protocol";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AskCard } from "./ask-card";
import { TodoProgress } from "./composer-lip";
import { PlanApproval, PlanCard, planOfArgs } from "./plan-card";

const PLAN: PlanDoc = {
  title: "加计划模式",
  summary: "先审阅再执行",
  steps: [
    { id: "1", title: "协议类型", files: ["a.ts"] },
    { id: "2", title: "扩展" },
  ],
  verification: ["pnpm test"],
};

describe("计划卡片", () => {
  it("等待批准时展开显示步骤与文件；已批准的默认收起", () => {
    const { rerender } = render(<PlanCard args={PLAN} running />);
    expect(screen.getByText("等待批准")).toBeTruthy();
    expect(screen.getByText("协议类型")).toBeTruthy();
    expect(screen.getByText("a.ts")).toBeTruthy();
    rerender(
      <PlanCard
        args={PLAN}
        details={{ id: "p1", status: "approved", plan: PLAN }}
        running={false}
      />,
    );
    expect(screen.getByText("已批准")).toBeTruthy();
  });

  it("参数还没有标题时显示“正在写计划”；工具报错时不显示", () => {
    const { container, rerender } = render(<PlanCard args={{}} running />);
    expect(screen.getByText("正在写计划…")).toBeTruthy();
    rerender(<PlanCard args={PLAN} details={{ id: "", status: "not_planning" }} running={false} />);
    expect(container.textContent).toBe("");
  });

  it("planOfArgs 容忍不完整的参数", () => {
    expect(planOfArgs({ title: "t", steps: [{ title: "a" }, null] })?.steps).toEqual([
      { id: "1", title: "a", files: [] },
    ]);
    expect(planOfArgs({ summary: "x" })).toBeUndefined();
  });
});

describe("计划审批", () => {
  it("批准按当前权限选择档位；继续完善需要填意见", () => {
    const onApprove = vi.fn();
    const onRevise = vi.fn();
    const { rerender } = render(
      <PlanApproval title="t" fullAccess={false} onApprove={onApprove} onRevise={onRevise} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "批准并执行" }));
    expect(onApprove).toHaveBeenLastCalledWith("edit");
    fireEvent.click(screen.getByRole("button", { name: "批准，每步询问" }));
    expect(onApprove).toHaveBeenLastCalledWith("ask");
    rerender(<PlanApproval title="t" fullAccess onApprove={onApprove} onRevise={onRevise} />);
    fireEvent.click(screen.getByRole("button", { name: "批准并执行" }));
    expect(onApprove).toHaveBeenLastCalledWith("keep");

    // 最后一行直接写修改意见：空的不能发送，Enter 发送
    const send = screen.getByRole("button", { name: "发送意见" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const box = screen.getByRole("textbox", { name: "修改意见" });
    fireEvent.change(box, { target: { value: "再加测试" } });
    fireEvent.submit(box);
    expect(onRevise).toHaveBeenCalledWith("再加测试");
    // 数字键选择选项
    fireEvent.keyDown(screen.getByRole("button", { name: "批准，每步询问" }), { key: "1" });
    expect(onApprove).toHaveBeenLastCalledWith("keep");
  });
});

describe("ask_user 提问卡片", () => {
  const ask = {
    id: "a1",
    questions: [
      {
        id: "depth",
        header: "目录层级",
        question: "要几级？",
        options: [{ label: "二级（推荐）", description: "简洁" }, { label: "三级" }],
      },
      { id: "pos", question: "放哪里？", options: [{ label: "开头" }, { label: "结尾" }] },
    ],
  };

  it("逐题回答：选项或自己写的想法，答完一起发回；推荐后缀改成标记", () => {
    const onAnswer = vi.fn();
    render(<AskCard ask={ask} onAnswer={onAnswer} onCancel={() => {}} />);
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByText("目录层级")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "二级" }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByText("放哪里？")).toBeTruthy();
    const box = screen.getByRole("textbox", { name: "自己写想法" });
    fireEvent.change(box, { target: { value: "放在徽章下面" } });
    fireEvent.submit(box);
    expect(onAnswer).toHaveBeenCalledWith({
      depth: { selected: "二级（推荐）" },
      pos: { other: "放在徽章下面" },
    });
  });

  it("关闭或 Esc 表示不回答", () => {
    const onCancel = vi.fn();
    render(<AskCard ask={ask} onAnswer={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "不回答" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "三级" }), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe("唇条的计划进度", () => {
  it("只显示当前步骤与进度；全部完成后不显示", () => {
    const { container, rerender } = render(
      <TodoProgress
        items={[
          { id: "1", text: "协议类型", status: "completed" },
          { id: "2", text: "扩展", status: "in_progress" },
          { id: "3", text: "前端", status: "pending" },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "计划进度 1/3：扩展" });
    expect(trigger.textContent).toContain("扩展");
    expect(trigger.textContent).not.toContain("前端");
    // 进行中的一步用转动的加载图标
    expect(trigger.querySelector(".session-spinner")).toBeTruthy();
    rerender(<TodoProgress items={[{ id: "1", text: "a", status: "completed" }]} />);
    expect(container.textContent).toBe("");
  });
});
