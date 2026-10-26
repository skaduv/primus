"use client";

import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { clamp } from "./panel-layout";

interface ResizeHandleProps {
  /** vertical：竖直分隔条，左右拖动改宽度；horizontal：水平分隔条，上下拖动改高度 */
  orientation: "vertical" | "horizontal";
  /** 无障碍名称，如“调整会话列表宽度” */
  label: string;
  value: number;
  min: number;
  max: number;
  /**
   * 指针向右（或向下）移动时尺寸的变化方向：左栏 +1（向右拖变宽）、右栏 -1（向左拖变宽）、
   * 底部抽屉 -1（向上拖变高）
   */
  direction: 1 | -1;
  onResize: (size: number) => void;
  /** 双击恢复默认尺寸 */
  onReset?: () => void;
  /** 键盘方向键每次调整的像素 */
  step?: number;
  className?: string;
}

/**
 * 栏间拖动条（第 16.2 节“左栏和右栏可以拖动宽度”）。WAI-ARIA 窗格分隔条：role="separator" 可聚焦，
 * 方向键按 step 调整、Shift 加速、Home / End 到上下限、双击或 Enter 恢复默认；指针拖动用 pointer capture，
 * 拖出窗口也能继续跟随。拖动条本身 8px，同时充当栏间距。
 */
export function ResizeHandle({
  orientation,
  label,
  value,
  min,
  max,
  direction,
  onResize,
  onReset,
  step = 16,
  className,
}: ResizeHandleProps) {
  const drag = useRef<{ pointer: number; origin: number; start: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const vertical = orientation === "vertical";
  const resize = (size: number) => onResize(clamp(size, min, max));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { pointer: e.pointerId, origin: vertical ? e.clientX : e.clientY, start: value };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const delta = (vertical ? e.clientX : e.clientY) - d.origin;
    resize(d.start + direction * delta);
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointer !== e.pointerId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    drag.current = null;
    setDragging(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const amount = e.shiftKey ? step * 4 : step;
    const keys: Partial<Record<string, number>> = vertical
      ? { ArrowLeft: -1, ArrowRight: 1 }
      : { ArrowUp: -1, ArrowDown: 1 };
    const sign = keys[e.key];
    if (sign !== undefined) resize(value + direction * sign * amount);
    else if (e.key === "Home") resize(min);
    else if (e.key === "End") resize(max);
    else if (e.key === "Enter" && onReset) onReset();
    else return;
    e.preventDefault();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> 不能聚焦与拖动；可调整的窗格分隔条按 WAI-ARIA 用 role="separator"
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative flex shrink-0 touch-none select-none items-center justify-center outline-none",
        vertical ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "rounded-full bg-accent/0 transition-colors duration-150",
          "group-hover:bg-accent/40 group-focus-visible:bg-accent group-data-[dragging]:bg-accent",
          vertical ? "h-10 w-[3px]" : "h-[3px] w-10",
        )}
      />
    </div>
  );
}
