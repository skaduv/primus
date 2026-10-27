"use client";

import type { ComponentProps } from "react";
import { useEffectiveTint } from "@/components/theme/appearance-controller";
import { useGlassDark } from "@/components/ui/glass";
import { GlassSurface } from "@/components/ui/glass-surface";
import { cn } from "@/lib/utils";

/** 深色下玻璃用更深的着色，避免大面积玻璃发灰发白 */
const DARK_TINT_COLOR = "30,30,34";

/**
 * 当前外观下的玻璃参数：着色程度跟随外观设置（系统"减少透明度"时为 1），
 * extra 为额外着色（大面积玻璃比小控件多一点，保证文字可读）。
 */
export function useGlassStyle(extra = 0): { tint: number; tintColor: string | undefined } {
  const tint = useEffectiveTint();
  const dark = useGlassDark();
  return {
    tint: Math.min(1, tint + extra + (dark ? 0.2 : 0)),
    tintColor: dark ? DARK_TINT_COLOR : undefined,
  };
}

// 浮在壁纸上的大块玻璃（侧栏、检查器、设置导航）
export function GlassPanel({
  className,
  radius = 16,
  ...props
}: Omit<ComponentProps<typeof GlassSurface>, "tint" | "tintColor">) {
  const glass = useGlassStyle(0.15);
  return (
    <GlassSurface
      blur={28}
      radius={radius}
      {...glass}
      className={cn("shadow-[0_8px_30px_-14px_rgb(0_0_0/0.3)]", className)}
      {...props}
    />
  );
}

/** 玻璃按钮的描边和投影：放在白色纸面或同为玻璃的面板上时也能看清轮廓 */
export const glassButtonClass =
  "shadow-[0_1px_2px_rgb(0_0_0/0.08),0_4px_12px_-4px_rgb(0_0_0/0.12)] ring-1 ring-black/[0.06] dark:ring-white/[0.08]";

/** 工具栏里的玻璃图标按钮 */
export const toolbarButtonClass = cn(
  glassButtonClass,
  "text-muted hover:text-fg aria-pressed:text-fg data-[state=open]:text-fg",
);
