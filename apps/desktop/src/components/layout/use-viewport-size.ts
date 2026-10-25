"use client";

import { useEffect, useState } from "react";

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * 当前窗口（WebView）的视口尺寸。只在 useEffect 中读取 window（第 16.1.1 节“避免水合问题”）：
 * 静态导出预渲染与首帧返回 null，由调用方按各栏自身上下限渲染；挂载后按真实尺寸重算，
 * 并跟随窗口缩放（rAF 合并同一帧内的多次 resize）。
 */
export function useViewportSize(): ViewportSize | null {
  const [size, setSize] = useState<ViewportSize | null>(null);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setSize((prev) =>
        prev && prev.width === window.innerWidth && prev.height === window.innerHeight
          ? prev
          : { width: window.innerWidth, height: window.innerHeight },
      );
    };
    const onResize = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return size;
}
