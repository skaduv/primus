import { describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明
import * as cr from "./cr-prereview.mjs";

const { decide, formatFinding, isRateLimit, parseLine, prePushPlan, reviewArgs, summarize } = cr;

const finding = (severity: string, extra: Record<string, unknown> = {}) => ({
  type: "finding",
  severity,
  fileName: "apps/desktop/src/a.ts",
  ...extra,
});
const done = (extra: Record<string, unknown> = {}) => ({
  type: "complete",
  status: "review_completed",
  ...extra,
});

describe("CodeRabbit 本地预审", () => {
  it("只解析 JSON 行，忽略普通输出与坏行", () => {
    expect(parseLine('{"type":"heartbeat"}')).toEqual({ type: "heartbeat" });
    expect(parseLine("Reviewing...")).toBeNull();
    expect(parseLine("{broken")).toBeNull();
  });

  it("有 critical / major 问题时阻止推送", () => {
    const s = summarize([finding("major"), finding("minor"), finding("critical"), done()]);
    expect(s.blocking).toBe(2);
    expect(s.counts).toEqual({ major: 1, minor: 1, critical: 1 });
    expect(decide(s).block).toBe(true);
  });

  it("只有 minor / trivial 时放行", () => {
    const s = summarize([finding("minor"), finding("trivial"), done()]);
    expect(decide(s)).toEqual({
      block: false,
      reason: "未发现 critical / major 问题",
    });
  });

  it("没有改动时放行", () => {
    const s = summarize([{ type: "complete", status: "review_skipped", findings: 0 }]);
    expect(s.skipped).toBe(true);
    expect(decide(s).block).toBe(false);
  });

  it("限流与失败不阻塞推送", () => {
    const limited = summarize([{ type: "error", errorType: "rate_limit", message: "Rate limit" }]);
    expect(isRateLimit(limited.error)).toBe(true);
    expect(decide(limited)).toEqual({
      block: false,
      reason: "CodeRabbit CLI 本小时额度已用完，本次不阻塞推送",
    });
    const failed = summarize([{ type: "error", errorType: "network", message: "offline" }]);
    expect(decide(failed).block).toBe(false);
  });

  it("审查不完整但已有 major 问题时仍阻止", () => {
    const s = summarize([finding("major"), done({ unreviewedFileCount: 3 })]);
    expect(s.incomplete).toBe(true);
    expect(decide(s).block).toBe(true);
  });

  it("没有 complete 事件视为未完成，不阻塞", () => {
    expect(decide(summarize([finding("minor")]))).toEqual({
      block: false,
      reason: "审查未完整结束，本次不阻塞推送",
    });
  });

  it("单行展示带行号与首行标题", () => {
    const text = formatFinding(finding("major", { startLine: 12, comment: "\n空指针\n详情" }));
    expect(text).toBe("[major] apps/desktop/src/a.ts:12 空指针");
  });

  it("参数只审查已提交改动并带合并基点", () => {
    expect(reviewArgs("abc123")).toEqual([
      "review",
      "--agent",
      "--committed",
      "--base-commit",
      "abc123",
    ]);
    expect(reviewArgs("")).toEqual(["review", "--agent", "--committed"]);
  });

  it("CLI 非零退出视为未完整结束，不单独阻塞", () => {
    const s = summarize([finding("minor"), done()], 2);
    expect(s.incomplete).toBe(true);
    expect(decide(s)).toEqual({
      block: false,
      reason: "审查未完整结束（CLI 退出码 2），本次不阻塞推送",
    });
    expect(decide(summarize([finding("major"), done()], 2)).block).toBe(true);
  });

  it("pre-push 只审查当前 HEAD，其他引用拒绝，纯删除不审查", () => {
    const head = "a".repeat(40);
    const zero = "0".repeat(40);
    const other = "b".repeat(40);
    expect(prePushPlan(`refs/heads/dev ${head} refs/heads/dev ${other}\n`, head)).toEqual({
      review: true,
      rejected: [],
    });
    expect(
      prePushPlan(
        `refs/heads/dev ${head} refs/heads/dev ${zero}\nrefs/heads/x ${other} refs/heads/x ${zero}\n`,
        head,
      ),
    ).toEqual({ review: true, rejected: ["refs/heads/x"] });
    expect(prePushPlan(`(delete) ${zero} refs/heads/old ${other}\n`, head)).toEqual({
      review: false,
      rejected: [],
    });
    expect(prePushPlan("", head)).toEqual({ review: false, rejected: [] });
  });
});
