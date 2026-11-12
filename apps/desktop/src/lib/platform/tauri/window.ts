import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import type { WindowControls } from "../window";

// 与 tauri.conf.json 的 minHeight 一致
const MIN_HEIGHT = 640;

// 当前窗口的标题栏操作；权限见 src-tauri/capabilities/default.json
//
// 最大化 / 全屏时不改窗口尺寸约束：tao 在 Windows 上的 set_min_inner_size 会用当前尺寸再调一次 set_inner_size
// 来“重新检查边界”，而 set_inner_size 会清掉最大化标记——最大化时开关侧栏会把窗口变成“最大化大小的普通窗口”，
// 之后的开合又按普通窗口去伸缩，布局就乱了。这里只记下想要的最小宽度，等窗口回到普通状态再设置。
export function createTauriWindowControls(): WindowControls {
  const win = getCurrentWindow();
  /** 铺满屏幕（最大化或全屏）：窗口尺寸由系统决定 */
  const filled = async () => {
    const [max, full] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
    return max || full;
  };
  let wantedMin: number | null = null;
  let appliedMin: number | null = null;
  const applyMin = async () => {
    if (wantedMin == null || wantedMin === appliedMin || (await filled())) return;
    const width = wantedMin;
    await win.setMinSize(new LogicalSize(width, MIN_HEIGHT));
    appliedMin = width;
  };
  // 从最大化 / 全屏还原后补上期间记下的最小宽度
  void win
    .onResized(() => {
      if (wantedMin !== appliedMin) void applyMin().catch(() => undefined);
    })
    .catch(() => undefined);
  return {
    minimize: () => win.minimize(),
    toggleMaximize: () => win.toggleMaximize(),
    close: () => win.close(),
    isMaximized: () => win.isMaximized(),
    // 全屏与最大化一样按“铺满屏幕”处理：侧栏只在窗口内开合，不伸缩窗口
    onMaximizedChange: async (listener) => {
      let last = await filled();
      listener(last);
      return win.onResized(async () => {
        const now = await filled();
        if (now !== last) {
          last = now;
          listener(now);
        }
      });
    },
    animateWidth: async (delta, duration, ease) => {
      if (await filled()) return false;
      const [scale, pos, size] = await Promise.all([
        win.scaleFactor(),
        win.outerPosition(),
        win.outerSize(),
      ]);
      const d = Math.round(delta * scale);
      if (d === 0) return true;
      const apply = (k: number) =>
        invoke("window_set_bounds", {
          x: pos.x,
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
    setMinWidth: async (width) => {
      wantedMin = width;
      await applyMin();
    },
    setAcrylic: (on) => (on ? win.setEffects({ effects: [Effect.Acrylic] }) : win.clearEffects()),
  };
}
