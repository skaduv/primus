import { beforeEach, describe, expect, it } from "vitest";
import { initialAppState, useAppStore } from "./app-store";

describe("全局 store", () => {
  beforeEach(() => useAppStore.setState(initialAppState));

  it("默认显示左右两栏", () => {
    const s = useAppStore.getState();
    expect(s.sessionsPanelOpen).toBe(true);
    expect(s.inspectorPanelOpen).toBe(true);
  });

  it("可以分别收起左栏和右栏", () => {
    useAppStore.getState().setSessionsPanelOpen(false);
    expect(useAppStore.getState().sessionsPanelOpen).toBe(false);
    expect(useAppStore.getState().inspectorPanelOpen).toBe(true);

    useAppStore.getState().setInspectorPanelOpen(false);
    expect(useAppStore.getState().inspectorPanelOpen).toBe(false);
  });
});
