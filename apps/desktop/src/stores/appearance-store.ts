import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// 外观设置（第 18 章"通用 · 主题"）。在薄壳的 settings_get/settings_set 接入前先存 localStorage；
// skipHydration 避免静态预渲染与客户端首帧不一致，由 AppearanceController 在挂载后恢复。

export type ThemeMode = "system" | "light" | "dark";

export interface AppearanceState {
  theme: ThemeMode;
  /** 玻璃着色程度：0 透明 ～ 1 着色（对应 macOS / iOS 27 的 Liquid Glass 外观滑块） */
  glassTint: number;
  setTheme: (theme: ThemeMode) => void;
  setGlassTint: (tint: number) => void;
}

export const initialAppearance = { theme: "system" as ThemeMode, glassTint: 0.35 };

export const clampTint = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      ...initialAppearance,
      setTheme: (theme) => set({ theme }),
      setGlassTint: (tint) => set({ glassTint: clampTint(tint) }),
    }),
    {
      name: "primus.appearance",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: ({ theme, glassTint }) => ({ theme, glassTint }),
    },
  ),
);

/** 按设置和系统偏好计算是否使用深色 */
export function resolveDark(theme: ThemeMode, systemDark: boolean): boolean {
  return theme === "dark" || (theme === "system" && systemDark);
}
