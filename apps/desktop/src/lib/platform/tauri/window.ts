import { invoke } from "@tauri-apps/api/core";
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
    animateBySide: async (side, delta, duration, ease) => {
      if (await win.isMaximized()) return false;
      const [scale, pos, size] = await Promise.all([
        win.scaleFactor(),
        win.outerPosition(),
        win.outerSize(),
      ]);
      const d = Math.round(delta * scale);
      if (d === 0) return true;
      const apply = (k: number) =>
        invoke("window_set_bounds", {
          x: side === "left" ? pos.x - k : pos.x,
          y: pos.y,
          width: size.width + k,
          height: size.height,
        }).catch(() => undefined);
      // 每帧最多一次 IPC：上一帧还没落地就跳过，避免排队造成拖尾
      let pending: Promise<unknown> | null = null;
      let last = 0;
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const k = Math.round(d * ease(t));
          if (t < 1) {
            if (!pending && k !== last) {
              last = k;
              pending = apply(k).finally(() => {
                pending = null;
              });
            }
            requestAnimationFrame(step);
            return;
          }
          void (async () => {
            await pending;
            if (last !== d) await apply(d);
            resolve();
          })();
        };
        requestAnimationFrame(step);
      });
      return true;
    },
  };
}
