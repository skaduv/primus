// 冒烟：应用能启动、主界面三栏都在（第 1 周 · 第 6 项）。
// 顶栏已移除（只留细标题栏与窗口按钮），左右栏的收起由 store 状态控制，不再有切换按钮。
import { $, expect } from "@wdio/globals";
import { strings } from "../../apps/desktop/src/lib/strings.ts";

describe("冒烟", () => {
  it("显示左侧会话栏", async () => {
    await expect($(`nav[aria-label="${strings.layout.sessions}"]`)).toBeExisting();
  });

  it("显示中央时间线", async () => {
    await expect($(`main[aria-label="${strings.layout.timeline}"]`)).toBeExisting();
  });

  it("显示右侧面板", async () => {
    await expect($("aside")).toBeExisting();
  });

  it("显示窗口按钮", async () => {
    await expect($(`button[aria-label="${strings.layout.close}"]`)).toBeExisting();
  });
});
