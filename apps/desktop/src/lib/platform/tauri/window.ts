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
    resizeBySide: async (side, delta, durationMs, ease) => {
      if (await win.isMaximized()) return false;
      const [scale, pos, size] = await Promise.all([
        win.scaleFactor(),
        win.outerPosition(),
        win.outerSize(),
      ]);
      const d = Math.round(delta * scale);
      const start = performance.now();
      return new Promise<boolean>((resolve) => {
        const step = (now: number) => {
          const p = Math.min(1, (now - start) / durationMs);
          const dw = Math.round(d * ease(p));
          if (side === "left") void win.setPosition(new PhysicalPosition(pos.x - dw, pos.y));
          void win.setSize(new PhysicalSize(size.width + dw, size.height));
          if (p < 1) requestAnimationFrame(step);
          else resolve(true);
        };
        requestAnimationFrame(step);
      });
    },
  };
}
