import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type WindowControls as Controls, setWindowControlsForTesting } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { WindowControls, WindowTitleBar } from "./window-controls";

const t = strings.layout;

function fakeControls() {
  let emit: (maximized: boolean) => void = () => {};
  const controls: Controls = {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => false),
    growBySide: vi.fn(async () => true),
    onMaximizedChange: vi.fn(async (listener) => {
      emit = listener;
      listener(false);
      return () => {};
    }),
  };
  return { controls, emit: (m: boolean) => emit(m) };
}

describe("自绘窗口按钮", () => {
  afterEach(() => setWindowControlsForTesting(undefined));

  it("浏览器预览（无窗口控制）不渲染", async () => {
    const { container } = render(<WindowControls />);
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("最小化、最大化、关闭调用窗口控制", async () => {
    const { controls } = fakeControls();
    setWindowControlsForTesting(controls);
    render(<WindowControls />);
    fireEvent.click(await screen.findByRole("button", { name: t.minimize }));
    fireEvent.click(screen.getByRole("button", { name: t.maximize }));
    fireEvent.click(screen.getByRole("button", { name: t.close }));
    expect(controls.minimize).toHaveBeenCalledOnce();
    expect(controls.toggleMaximize).toHaveBeenCalledOnce();
    expect(controls.close).toHaveBeenCalledOnce();
  });

  it("最大化后按钮变为向下还原", async () => {
    const fake = fakeControls();
    setWindowControlsForTesting(fake.controls);
    render(<WindowControls />);
    await screen.findByRole("button", { name: t.maximize });
    act(() => fake.emit(true));
    expect(screen.getByRole("button", { name: t.restore })).toBeTruthy();
  });

  it("细标题栏整条是拖动区", async () => {
    const { container } = render(<WindowTitleBar />);
    await act(async () => {});
    expect((container.firstChild as HTMLElement).hasAttribute("data-tauri-drag-region")).toBe(true);
  });
});
