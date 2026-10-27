import { getCurrentWindow } from "@tauri-apps/api/window";
import type { WindowControls } from "../window";

// 当前窗口的标题栏操作；权限见 src-tauri/capabilities/default.json
export function createTauriWindowControls(): WindowControls {
  const win = getCurrentWindow();
  return {
    minimize: () => win.minimize(),
    toggleMaximize: () => win.toggleMaximize(),
    close: () => win.close(),
    isMaximized: () => win.isMaximized(),
    onMaximizedChange: async (listener) => {
      let last = await win.isMaximized();
      listener(last);
      return win.onResized(async () => {
        const now = await win.isMaximized();
        if (now !== last) {
          last = now;
          listener(now);
        }
      });
    },
  };
}
