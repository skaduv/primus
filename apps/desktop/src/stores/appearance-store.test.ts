import { beforeEach, describe, expect, it } from "vitest";
import { clampTint, initialAppearance, resolveDark, useAppearanceStore } from "./appearance-store";

describe("外观设置", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppearanceStore.setState(initialAppearance);
  });

  it("按设置与系统偏好决定深色", () => {
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("dark", false)).toBe(true);
  });

  it("玻璃着色限制在 0～1", () => {
    expect(clampTint(-1)).toBe(0);
    expect(clampTint(2)).toBe(1);
    expect(clampTint(Number.NaN)).toBe(0);
    useAppearanceStore.getState().setGlassTint(1.5);
    expect(useAppearanceStore.getState().glassTint).toBe(1);
  });

  it("修改后写入 localStorage，重新加载时恢复", async () => {
    useAppearanceStore.getState().setTheme("dark");
    expect(JSON.parse(localStorage.getItem("primus.appearance") ?? "{}").state).toEqual({
      theme: "dark",
      glassTint: initialAppearance.glassTint,
    });
    // 模拟下次启动：存储里是上次的值，store 先是默认值，挂载后恢复
    localStorage.setItem(
      "primus.appearance",
      JSON.stringify({ state: { theme: "light", glassTint: 0.8 }, version: 1 }),
    );
    await useAppearanceStore.persist.rehydrate();
    expect(useAppearanceStore.getState()).toMatchObject({ theme: "light", glassTint: 0.8 });
  });
});
