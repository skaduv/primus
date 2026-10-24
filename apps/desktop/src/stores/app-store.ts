import { create } from "zustand";

// 全局 store（第 16.4 节）。目前只有主界面布局状态；工作区、设置、会话索引后续加入。
export interface AppState {
  /** 左栏：会话列表 */
  sessionsPanelOpen: boolean;
  /** 右栏：变更 / 文件 / 计划 */
  inspectorPanelOpen: boolean;
  setSessionsPanelOpen: (open: boolean) => void;
  setInspectorPanelOpen: (open: boolean) => void;
}

export const initialAppState = {
  sessionsPanelOpen: true,
  inspectorPanelOpen: true,
} satisfies Partial<AppState>;

export const useAppStore = create<AppState>()((set) => ({
  ...initialAppState,
  setSessionsPanelOpen: (open) => set({ sessionsPanelOpen: open }),
  setInspectorPanelOpen: (open) => set({ inspectorPanelOpen: open }),
}));
