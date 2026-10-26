import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "./resize-handle";

function Harness({
  initial = 232,
  direction = 1 as 1 | -1,
  orientation = "vertical" as "vertical" | "horizontal",
  onReset = vi.fn(),
}) {
  const [size, setSize] = useState(initial);
  return (
    <>
      <ResizeHandle
        orientation={orientation}
        label="调整宽度"
        value={size}
        min={200}
        max={400}
        direction={direction}
        onResize={setSize}
        onReset={() => {
          onReset();
          setSize(initial);
        }}
      />
      <output>{size}</output>
    </>
  );
}

const separator = () => screen.getByRole("separator", { name: "调整宽度" });
const size = () => Number(document.querySelector("output")?.textContent);

describe("ResizeHandle", () => {
  it("暴露窗格分隔条的无障碍属性", () => {
    render(<Harness />);
    const sep = separator();
    expect(sep.getAttribute("aria-orientation")).toBe("vertical");
    expect(sep.getAttribute("aria-valuenow")).toBe("232");
    expect(sep.getAttribute("aria-valuemin")).toBe("200");
    expect(sep.getAttribute("aria-valuemax")).toBe("400");
    expect(sep.tabIndex).toBe(0);
  });

  it("方向键按步长调整，Shift 加速，Home / End 到上下限，不越界", () => {
    render(<Harness />);
    const sep = separator();
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(size()).toBe(248);
    fireEvent.keyDown(sep, { key: "ArrowLeft", shiftKey: true });
    expect(size()).toBe(200);
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(size()).toBe(200);
    fireEvent.keyDown(sep, { key: "End" });
    expect(size()).toBe(400);
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(size()).toBe(400);
    fireEvent.keyDown(sep, { key: "Home" });
    expect(size()).toBe(200);
  });

  it("右栏（direction -1）向左拖变宽；水平分隔条用上下方向键", () => {
    const { unmount } = render(<Harness direction={-1} />);
    fireEvent.keyDown(separator(), { key: "ArrowLeft" });
    expect(size()).toBe(248);
    unmount();
    render(<Harness orientation="horizontal" direction={-1} initial={300} />);
    fireEvent.keyDown(separator(), { key: "ArrowUp" });
    expect(size()).toBe(316);
    fireEvent.keyDown(separator(), { key: "ArrowRight" });
    expect(size()).toBe(316);
  });

  it("指针拖动按位移调整并夹在上下限内，松开后不再跟随", () => {
    render(<Harness />);
    const sep = separator();
    fireEvent.pointerDown(sep, { button: 0, pointerId: 1, clientX: 500 });
    expect(sep.hasAttribute("data-dragging")).toBe(true);
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 540 });
    expect(size()).toBe(272);
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 900 });
    expect(size()).toBe(400);
    fireEvent.pointerMove(sep, { pointerId: 2, clientX: 100 });
    expect(size()).toBe(400);
    fireEvent.pointerUp(sep, { pointerId: 1, clientX: 900 });
    expect(sep.hasAttribute("data-dragging")).toBe(false);
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 100 });
    expect(size()).toBe(400);
  });

  it("双击或 Enter 恢复默认尺寸", () => {
    const onReset = vi.fn();
    render(<Harness onReset={onReset} />);
    const sep = separator();
    fireEvent.keyDown(sep, { key: "End" });
    fireEvent.doubleClick(sep);
    expect(size()).toBe(232);
    fireEvent.keyDown(sep, { key: "End" });
    fireEvent.keyDown(sep, { key: "Enter" });
    expect(size()).toBe(232);
    expect(onReset).toHaveBeenCalledTimes(2);
  });
});
