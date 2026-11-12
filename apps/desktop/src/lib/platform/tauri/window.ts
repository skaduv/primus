import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import type { WindowControls } from "../window";

// 与 tauri.conf.json 的 minHeight 一致
const MIN_HEIGHT = 640;

/**
 * Win10（含更早）没有 DWM 系统背景材质：window-vibrancy 的亚克力会退回 SetWindowCompositionAttribute，
 * 不传颜色时几乎不着色，只剩模糊的桌面，发灰发脏且拖动卡顿。这类系统不开亚克力，页面铺实色底（public/theme-init.js 加 solid-window）。
 * WebView2 判断 Win11 的官方办法：UA Client Hints 的 platformVersion 主版本 ≥ 13。
 */
export async function isLegacyWindows(): Promise<boolean> {
  const ua = (
    navigator as Navigator & {
      userAgentData?: {
        getHighEntropyValues?(
          hints: string[],
        ): Promise<{ platform?: string; platformVersion?: string }>;
      };
    }
  ).userAgentData;
  try {
    const v = await ua?.getHighEntropyValues?.(["platformVersion"]);
    if (v?.platform !== "Windows") return false;
    const major = Number.parseInt(String(v.platformVersion ?? "").split(".")[0] ?? "", 10);
    return major > 0 && major < 13;
  } catch {
    return false;
  }
}

// 当前窗口的标题栏操作；权限见 src-tauri/capabilities/default.json
//
// 最大化 / 全屏时不改窗口尺寸约束：tao 在 Windows 上的 set_min_inner_size 会用当前尺寸再调一次 set_inner_size
// 来“重新检查边界”，而 set_inner_size 会清掉最大化标记——最大化时开关侧栏会把窗口变成“最大化大小的普通窗口”，
// 之后的开合又按普通窗口去伸缩，布局就乱了。这里只记下想要的最小宽度，等窗口回到普通状态再设置。
export function createTauriWindowControls(): WindowControls {
  const win = getCurrentWindow();
  const legacy = isLegacyWindows();
  /** 铺满屏幕（最大化或全屏）：窗口尺寸由系统决定 */
  const filled = async () => {
    const [max, full] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
    return max || full;
  };
  let wantedMin: number | null = null;
  let appliedMin: number | null = null;
  // 同一时间只跑一个设置任务；每次设置完再看最新目标，直到已设置的与最新目标一致（期间又改了目标不会丢）
  // （先登记任务再在它结束后清掉；任务体可能同步跑完，不能在任务体里清，否则清空后又被登记成已完成的任务）
  let running: Promise<void> | null = null;
  let acrylicSeq = 0;
  const applyMin = (): Promise<void> => {
    if (running) return running;
    const task = (async () => {
      while (wantedMin != null && wantedMin !== appliedMin && !(await filled())) {
        const width = wantedMin;
        await win.setMinSize(new LogicalSize(width, MIN_HEIGHT));
        appliedMin = width;
      }
    })();
    running = task;
    const clear = () => {
      if (running === task) running = null;
    };
    task.then(clear, clear);
    return task;
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
    // tauri.conf.json 建窗时已开亚克力；Win10 上 AppearanceController 首次调用这里时关掉
    // 调用可能重叠（开启要先等 Win10 判断）：只应用最后一次请求，较早的开启不会盖过较晚的关闭
    setAcrylic: async (on) => {
      const seq = ++acrylicSeq;
      const isLegacy = await legacy;
      if (seq !== acrylicSeq) return;
      await (on && !isLegacy ? win.setEffects({ effects: [Effect.Acrylic] }) : win.clearEffects());
    },
  };
}
