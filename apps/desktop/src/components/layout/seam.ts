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

/**
 * 侧栏玻璃在接缝一侧多出的宽度：玻璃的高光描边与折射边带（最宽约 24px）被推到裁剪区之外，
 * 接缝处只剩干净的玻璃，不露线。外层负责裁剪、凹口和投影。
 */
export const SEAM_BLEED = 28;
export function seamBleedStyle(side: "left" | "right", width: number): CSSProperties {
  return side === "left"
    ? {
        width: width + SEAM_BLEED,
        paddingRight: SEAM_BLEED,
        borderRadius: `${OUTER_RADIUS}px 0 0 ${OUTER_RADIUS}px`,
      }
    : {
        width: width + SEAM_BLEED,
        marginLeft: -SEAM_BLEED,
        paddingLeft: SEAM_BLEED,
        borderRadius: `0 ${OUTER_RADIUS}px ${OUTER_RADIUS}px 0`,
      };
}

/** 侧栏外层：裁剪 + 凹口 + 投影（玻璃自身投影被裁掉，改由这里画） */
export const sideShellClass =
  "seam-mask flex shrink-0 overflow-hidden shadow-[0_14px_24px_-18px_rgb(0_0_0/0.35)]";

/** 中央面板的接缝形状：贴着侧栏的一边直角 + 凹口，另一边保持外侧圆角；投影只往下，不横向外溢到相邻栏 */
export function centerSeamStyle(leftAttached: boolean, rightAttached: boolean): CSSProperties {
  const l = leftAttached ? 0 : OUTER_RADIUS;
  const r = rightAttached ? 0 : OUTER_RADIUS;
  return {
    borderRadius: `${l}px ${r}px ${r}px ${l}px`,
    ["--nl" as string]: `${leftAttached ? SEAM_NOTCH : 0}px`,
    ["--nr" as string]: `${rightAttached ? SEAM_NOTCH : 0}px`,
    boxShadow: "0 14px 24px -18px rgb(0 0 0 / 0.35)",
  };
}
