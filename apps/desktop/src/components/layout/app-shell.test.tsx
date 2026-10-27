import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { strings } from "@/lib/strings";
import { initialAppState, useAppStore } from "@/stores/app-store";
import { AppShell } from "./app-shell";

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

/** 面板外层玻璃容器（GlassPanel 根元素，带 shrink-0 与内联尺寸）的样式 */
const panelStyle = (el: HTMLElement) => (el.closest(".shrink-0") as HTMLElement).style;

describe("主界面外壳", () => {
  const original = { width: window.innerWidth, height: window.innerHeight };
  beforeEach(() => {
    useAppStore.setState(initialAppState);
    setViewport(1280, 800);
  });
  afterEach(() => setViewport(original.width, original.height));

  it("显示三栏，不再有顶栏", () => {
    render(<AppShell />);
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.getByRole("navigation", { name: strings.layout.sessions })).toBeTruthy();
    expect(screen.getByRole("main", { name: strings.layout.timeline })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: strings.layout.inspector })).toBeTruthy();
  });

  it("按 store 状态收起左右栏（吸附动画结束后卸载）", async () => {
    render(<AppShell />);
    act(() => useAppStore.setState({ sessionsPanelOpen: false, inspectorPanelOpen: false }));
    await waitFor(() => {
      expect(screen.queryByRole("navigation", { name: strings.layout.sessions })).toBeNull();
      expect(screen.queryByRole("complementary", { name: strings.layout.inspector })).toBeNull();
    });
  });

  it("纸面角上的开关按钮收起、展开左右栏", () => {
    render(<AppShell />);
    fireEvent.click(screen.getByRole("button", { name: strings.layout.hideSessions }));
    expect(useAppStore.getState().sessionsPanelOpen).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: strings.layout.showSessions }));
    expect(useAppStore.getState().sessionsPanelOpen).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: strings.layout.hideInspector }));
    expect(useAppStore.getState().inspectorPanelOpen).toBe(false);
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

  it("左右栏有可聚焦的拖动条；底部抽屉默认收起，打开后可切换标签", () => {
    render(<AppShell />);
    expect(screen.getByRole("separator", { name: strings.layout.resizeSessions })).toBeTruthy();
    expect(screen.getByRole("separator", { name: strings.layout.resizeInspector })).toBeTruthy();
    expect(screen.queryByRole("region", { name: strings.layout.drawer })).toBeNull();

    act(() => useAppStore.setState({ bottomDrawerOpen: true }));
    const drawer = screen.getByRole("region", { name: strings.layout.drawer });
    expect(panelStyle(drawer).height).toBe("220px");
    expect(screen.getByRole("separator", { name: strings.layout.resizeDrawer })).toBeTruthy();
    expect(screen.getByRole("tab", { name: strings.drawerTabs.terminal })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: strings.drawerTabs.logs }));
    expect(screen.getByText(strings.drawerTabs.logsEmpty)).toBeTruthy();

    act(() => useAppStore.setState({ bottomDrawerOpen: false }));
    expect(screen.queryByRole("region", { name: strings.layout.drawer })).toBeNull();
  });

  it("拖动条调整左栏宽度并写回 store，收起左栏时拖动条一起隐藏", () => {
    render(<AppShell />);
    const nav = screen.getByRole("navigation", { name: strings.layout.sessions });
    expect(panelStyle(nav).width).toBe("232px");
    const handle = screen.getByRole("separator", { name: strings.layout.resizeSessions });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(useAppStore.getState().sessionsPanelWidth).toBe(248);
    expect(panelStyle(nav).width).toBe("248px");
    act(() => useAppStore.setState({ sessionsPanelOpen: false }));
    expect(screen.queryByRole("separator", { name: strings.layout.resizeSessions })).toBeNull();
  });

  it("最小窗口 960×640 下把过宽的栏收缩到中央放得下，窗口放大后恢复", async () => {
    useAppStore.setState({ sessionsPanelWidth: 400, inspectorPanelWidth: 560 });
    setViewport(960, 640);
    render(<AppShell />);
    const nav = screen.getByRole("navigation", { name: strings.layout.sessions });
    const aside = screen.getByRole("complementary", { name: strings.layout.inspector });
    // 960 - 内边距 16 - 中央下限 380 = 564（拖动条叠在接缝上不占宽度）：右栏先压到下限 240，左栏得 324
    expect(panelStyle(aside).width).toBe("240px");
    expect(panelStyle(nav).width).toBe("324px");
    expect(
      screen
        .getByRole("separator", { name: strings.layout.resizeSessions })
        .getAttribute("aria-valuemax"),
    ).toBe("324");

    act(() => {
      setViewport(2560, 1440);
      window.dispatchEvent(new Event("resize"));
    });
    await waitFor(() => {
      expect(panelStyle(nav).width).toBe("400px");
      expect(panelStyle(aside).width).toBe("560px");
    });
  });
});
