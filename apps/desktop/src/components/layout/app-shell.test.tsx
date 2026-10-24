import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { strings } from "@/lib/strings";
import { initialAppState, useAppStore } from "@/stores/app-store";
import { AppShell } from "./app-shell";

describe("主界面外壳", () => {
  beforeEach(() => useAppStore.setState(initialAppState));

  it("显示产品名和三栏", () => {
    render(<AppShell />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(strings.appName);
    expect(screen.getByRole("navigation", { name: strings.layout.sessions })).toBeTruthy();
    expect(screen.getByRole("main", { name: strings.layout.timeline })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: strings.layout.inspector })).toBeTruthy();
  });

  it("点击切换按钮收起和展开左栏", () => {
    render(<AppShell />);
    const toggle = screen.getByRole("button", { name: strings.layout.toggleSessions });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("navigation", { name: strings.layout.sessions })).toBeNull();
    expect(useAppStore.getState().sessionsPanelOpen).toBe(false);

    fireEvent.click(toggle);
    expect(screen.getByRole("navigation", { name: strings.layout.sessions })).toBeTruthy();
  });

  it("点击切换按钮收起右栏", () => {
    render(<AppShell />);
    fireEvent.click(screen.getByRole("button", { name: strings.layout.toggleInspector }));
    expect(screen.queryByRole("complementary", { name: strings.layout.inspector })).toBeNull();
  });
});
