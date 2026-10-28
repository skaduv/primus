import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import mark from "./logo-mark.png";

/** 乾元标志：线稿用作遮罩，颜色跟随文字色（深浅主题自动适配） */
export function LogoMark({ size = 56, className }: { size?: number; className?: string }) {
  const src = typeof mark === "string" ? mark : mark.src;
  const style: CSSProperties = {
    width: size,
    height: size,
    maskImage: `url(${src})`,
    WebkitMaskImage: `url(${src})`,
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
  };
  return <span aria-hidden className={cn("inline-block bg-current", className)} style={style} />;
}
