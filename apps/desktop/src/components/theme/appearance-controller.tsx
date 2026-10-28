"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getWindowControls } from "@/lib/platform";
import { resolveDark, useAppearanceStore } from "@/stores/appearance-store";

// 把外观设置应用到 <html>：切换 dark 类（Tailwind dark 变体与 lore-glass 都读它）。
// 只在客户端运行，静态导出的外壳不受影响。
export function AppearanceController() {
  const theme = useAppearanceStore((s) => s.theme);

  useEffect(() => {
    void useAppearanceStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.classList.toggle(
        "dark",
        resolveDark(theme, media?.matches ?? false),
      );
    };
    apply();
    media?.addEventListener("change", apply);
    return () => media?.removeEventListener("change", apply);
  }, [theme]);

  // 玻璃效果拉到最低：窗口背景完全透明（关闭亚克力、去掉底层着色）；其余档位保持磨砂，滑块只改界面着色深度
  const clear = useEffectiveTint() === 0;
  useEffect(() => {
    document.documentElement.classList.toggle("glass-clear", clear);
    void getWindowControls()
      .then((c) => c?.setAcrylic(!clear))
      .catch(() => {});
  }, [clear]);

  return null;
}

/** 订阅媒体查询；服务端与首帧返回 false，避免水合不一致 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia?.(query);
      media?.addEventListener("change", onChange);
      return () => media?.removeEventListener("change", onChange);
    },
    () => window.matchMedia?.(query).matches === true,
    () => false,
  );
}

/** 当前生效的玻璃着色：系统开启"减少透明度"时统一按完全着色处理 */
export function useEffectiveTint(): number {
  const tint = useAppearanceStore((s) => s.glassTint);
  const reduced = useMediaQuery("(prefers-reduced-transparency: reduce)");
  return reduced ? 1 : tint;
}
