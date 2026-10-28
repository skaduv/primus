"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface SliderProps {
  ariaLabel: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number) => void;
  disabled?: boolean;
  className?: string;
}

/** 滑杆（自绘）：原生 range 负责语义与键盘，外观见 globals.css .ui-range */
export function Slider({
  ariaLabel,
  value,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  disabled,
  className,
}: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      readOnly={!onValueChange}
      onChange={(e) => onValueChange?.(Number(e.target.value))}
      className={cn("ui-range w-44", className)}
      style={{ "--pct": `${pct}%` } as CSSProperties}
    />
  );
}
