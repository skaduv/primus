import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
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

  it("右栏标签切换变更、文件、计划", () => {
    render(<AppShell />);
    const t = strings.inspectorTabs;
    expect(screen.getByText(t.changesEmpty)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: t.files }));
    expect(screen.getByText(t.filesEmpty)).toBeTruthy();
    expect(screen.queryByText(t.changesEmpty)).toBeNull();
  });

  it("左栏设置按钮打开设置页", () => {
    render(<AppShell />);
    fireEvent.click(screen.getByRole("button", { name: strings.layout.settings }));
    expect(useRouter().push).toHaveBeenCalledWith("/settings/");
  });

  it("空会话显示欢迎页，点建议填入输入框", () => {
    render(<AppShell />);
    const suggestion = strings.chat.suggestions[0];
    fireEvent.click(screen.getByRole("button", { name: suggestion }));
    const input = screen.getByRole("textbox", { name: strings.chat.inputLabel });
    expect((input as HTMLTextAreaElement).value).toBe(suggestion);
  });
});
