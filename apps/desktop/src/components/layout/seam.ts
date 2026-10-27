import type { CSSProperties } from "react";

/** 外侧圆角；接缝处是直角 + seam-mask 刻出的平滑凹口，两块面板贴合后像液体融在一起 */
export const OUTER_RADIUS = 16;
/** 接缝凹口宽度（每块面板各刻一半，深度为宽度的 6/14，见 globals.css .seam-mask） */
export const SEAM_NOTCH = 14;

/** 侧栏贴合中央那一侧的形状：直角 + 凹口 */
export function sidePanelSeamStyle(side: "left" | "right"): CSSProperties {
  return side === "left"
    ? {
        borderRadius: `${OUTER_RADIUS}px 0 0 ${OUTER_RADIUS}px`,
        ["--nr" as string]: `${SEAM_NOTCH}px`,
      }
    : {
        borderRadius: `0 ${OUTER_RADIUS}px ${OUTER_RADIUS}px 0`,
        ["--nl" as string]: `${SEAM_NOTCH}px`,
      };
}
