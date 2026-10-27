import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
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
    growBySide: async (side, delta) => {
      if (await win.isMaximized()) return false;
      const [scale, pos, inner] = await Promise.all([
        win.scaleFactor(),
        win.outerPosition(),
        win.innerSize(),
      ]);
      const d = Math.round(delta * scale);
      if (d === 0) return true;
      // 两次调用同时发出，落在同一帧，左侧伸缩时右边缘不跳
      await Promise.all([
        win.setSize(new PhysicalSize(inner.width + d, inner.height)),
        side === "left" ? win.setPosition(new PhysicalPosition(pos.x - d, pos.y)) : null,
      ]);
      return true;
    },
  };
}
