import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Platform, setPlatformForTesting } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { type ModelCall, UsageSettings } from "./usage-settings";

const t = strings.settings.usage;

function todayOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function call(id: string, days: number, model: string, total: number): ModelCall {
  return {
    id,
    timestamp: todayOffset(days),
    model,
    input: total,
    output: 0,
    total,
    cost: { amount: 0.01, currency: "USD", estimated: true },
    status: "success",
  };
}

describe("用量设置", () => {
  afterEach(() => {
    setPlatformForTesting(undefined);
  });

  it("无统计来源时显示空状态，并以浅蓝显示日历", () => {
    render(<UsageSettings />);

    expect(screen.getAllByText(t.noData)).toHaveLength(5);
    expect(screen.getAllByRole("img", { name: /请求次数：暂无数据/ })[0]?.className).toContain(
      "bg-usage-0",
    );
  });

  it("当前月在首位，显示完整十二个月且隐藏星期标注", () => {
    render(<UsageSettings />);
    const heatmap = within(screen.getByRole("region", { name: t.heatmap }));
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("zh-CN", { month: "short" });
    const months = Array.from({ length: 12 }, (_, offset) =>
      formatter.format(new Date(now.getFullYear(), now.getMonth() - offset, 1)),
    );
    expect(
      heatmap.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent),
    ).toEqual(months);
    const dayCount = Array.from({ length: 12 }, (_, offset) =>
      new Date(now.getFullYear(), now.getMonth() - offset + 1, 0).getDate(),
    ).reduce((total, days) => total + days, 0);
    expect(heatmap.getAllByRole("img")).toHaveLength(dayCount);
    for (const weekday of t.weekdays) {
      expect(heatmap.queryByText(weekday)).toBeNull();
    }
  });

  it("表头日历仅过滤调用记录，统计卡保持周期总量", () => {
    render(
      <UsageSettings
        calls={[call("recent", -1, "Recent", 100), call("older", -180, "Older", 200)]}
        completedAt={[todayOffset(-180)]}
      />,
    );

    const table = within(screen.getByRole("table", { name: t.calls }));
    expect(table.getByText("Older")).toBeTruthy();
    expect(screen.getByText("300")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getAllByText(/USD.*估算/)).toHaveLength(3);

    expect(screen.queryByRole("combobox", { name: t.model })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.time }));
    expect(screen.getByLabelText(t.date, { selector: "input" }).getAttribute("value")).toBe(
      screen.getByLabelText(t.date, { selector: "input" }).getAttribute("max"),
    );
    expect(screen.queryByRole("button", { name: t.date })).toBeNull();
    expect(screen.getByRole("button", { name: t.time })).toBeTruthy();
    // 只打开弹层不提交筛选
    expect(table.getByText("Older")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.applyDate }));
    expect(table.getByText(t.noMatchingCalls)).toBeTruthy();
    expect(screen.getByText("300")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t.time }));
    fireEvent.click(screen.getByRole("button", { name: t.clearDate }));
    expect(table.getByText("Older")).toBeTruthy();
    expect(table.getByText("Recent")).toBeTruthy();
  });

  it("按 Escape 取消日期选择时保留原有记录", () => {
    render(<UsageSettings calls={[call("older", -3, "Older", 200)]} />);
    const table = within(screen.getByRole("table", { name: t.calls }));
    fireEvent.click(screen.getByRole("button", { name: t.time }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: t.date }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: t.date })).toBeNull();
    expect(table.getByText("Older")).toBeTruthy();

    // 焦点停留在触发按钮上时，全局按 Escape 也应关闭弹层
    fireEvent.click(screen.getByRole("button", { name: t.time }));
    expect(screen.getByRole("dialog", { name: t.date })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: t.date })).toBeNull();
  });

  it("热力图与模型列使用统一委托悬停提示，不使用原生 title", () => {
    const { container } = render(<UsageSettings calls={[call("m1", -1, "ModelX", 42)]} />);
    expect(container.querySelector("[title]")).toBeNull();
    const modelCell = screen.getByText("ModelX");
    expect(modelCell.getAttribute("data-tooltip")).toBe("ModelX");
    const heatmap = within(screen.getByRole("region", { name: t.heatmap }));
    expect(heatmap.getAllByRole("img")[0]?.getAttribute("data-tooltip")).toBeTruthy();
  });

  it("空调用记录的 Token 总量为 0，无来源或 total 未知时保持暂无数据", () => {
    const { unmount } = render(<UsageSettings calls={[]} />);
    const tokensCard = () => screen.getByText(t.tokens, { selector: "dt" }).nextElementSibling;
    expect(tokensCard()?.textContent).toBe("0");
    unmount();

    render(<UsageSettings calls={[{ ...call("unknown", -1, "Unknown", 1), total: null }]} />);
    expect(tokensCard()?.textContent).toBe(t.noData);
  });

  it("每日和累计总量按真实 Token 计算", () => {
    render(
      <UsageSettings calls={[call("light", -1, "First", 5), call("heavy", -2, "Second", 100)]} />,
    );
    const key = new Date(todayOffset(-1));
    const date = [
      key.getFullYear(),
      String(key.getMonth() + 1).padStart(2, "0"),
      String(key.getDate()).padStart(2, "0"),
    ].join("-");
    const heatmap = within(screen.getByRole("region", { name: t.heatmap }));
    const cell = () =>
      heatmap.getAllByRole("img").find((node) => node.getAttribute("aria-label")?.startsWith(date));
    expect(cell()?.className).toContain("bg-usage-1");
    fireEvent.mouseDown(screen.getByRole("tab", { name: t.metrics.cumulative }));
    expect(cell()?.getAttribute("aria-label")).toContain("Token 消耗：105");
    expect(cell()?.className).toContain("bg-usage-4");
    fireEvent.mouseDown(screen.getByRole("tab", { name: t.metrics.weekly }));
    expect(cell()?.getAttribute("aria-label")).toContain("每周：");
  });

  it("开启 autoLoad 时自动从平台加载真实会话调用与完成任务统计，并支持手动刷新", async () => {
    const usageStats = vi.fn(async () => ({
      calls: [call("real-1", -1, "gemini-4-neon-xhigh", 2400)],
      completedAt: [todayOffset(-1)],
    }));
    setPlatformForTesting({
      authStatus: async () => ({ loggedIn: false, account: null, loginAvailable: false }),
      usageStats,
    } as unknown as Platform);

    render(<UsageSettings autoLoad />);
    const table = within(await screen.findByRole("table", { name: t.calls }));
    expect(await table.findByText("gemini-4-neon-xhigh")).toBeTruthy();
    expect(screen.getAllByText("2,400").length).toBeGreaterThan(0);
    expect(usageStats).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: t.refresh }));
    await waitFor(() => expect(usageStats).toHaveBeenCalledTimes(2));
  });

  describe("跨过当地午夜", () => {
    afterEach(() => vi.useRealTimers());

    it("日期变化后新的调用计入时间窗口", () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(new Date(2026, 10, 20, 23, 59, 30));
      const late: ModelCall = {
        ...call("next-day", 0, "NextDay", 42),
        timestamp: new Date(2026, 10, 21, 0, 0, 10).getTime(),
      };
      const { rerender } = render(<UsageSettings calls={[]} />);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      rerender(<UsageSettings calls={[late]} />);
      const table = within(screen.getByRole("table", { name: t.calls }));
      expect(table.getByText("NextDay")).toBeTruthy();
    });
  });
});
