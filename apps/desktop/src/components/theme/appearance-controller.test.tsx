import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { initialAppearance, useAppearanceStore } from "@/stores/appearance-store";
import { AppearanceController } from "./appearance-controller";

describe("外观控制器", () => {
  afterEach(() => {
    useAppearanceStore.setState(initialAppearance);
    document.documentElement.classList.remove("dark");
  });

  it("按主题切换 <html> 的 dark 类", () => {
    render(<AppearanceController />);
    // 测试环境的系统偏好为浅色
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    act(() => useAppearanceStore.getState().setTheme("dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    act(() => useAppearanceStore.getState().setTheme("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
