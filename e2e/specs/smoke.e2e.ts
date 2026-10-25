// 冒烟：应用能启动、首页标题正确、左右栏可以切换（第 1 周 · 第 6 项）。
import { $, expect } from "@wdio/globals";
import { strings } from "../../apps/desktop/src/lib/strings.ts";

describe("冒烟", () => {
  it("显示应用名称", async () => {
    await expect($("h1")).toHaveText(strings.appName);
  });

  it("左侧会话栏可隐藏与恢复", async () => {
    const toggle = $(`button[aria-label="${strings.layout.toggleSessions}"]`);
    const panel = $(`nav[aria-label="${strings.layout.sessions}"]`);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(panel).toBeExisting();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(panel).not.toBeExisting();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(panel).toBeExisting();
  });

  it("右侧面板可隐藏与恢复", async () => {
    const toggle = $(`button[aria-label="${strings.layout.toggleInspector}"]`);
    const panel = $("aside");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(panel).toBeExisting();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(panel).not.toBeExisting();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(panel).toBeExisting();
  });
});
