"use client";

// 分段切换（Liquid Glass 风格）。无障碍原语用 Radix Tabs。
// 结构：浅浅凹下去的半透明轨道 → 选中项下方的玻璃"水滴"（亮面、高光描边、柔和投影，文字保持清晰）→ 文字
//      → 文字上方的一层透镜（与水滴同形同位），只在滑动时显现：Chromium 下用 backdrop-filter: url(#位移贴图)
//        把压在下面的文字放大、边缘弯折，像透过一滴水看文字。
// 切换时水滴按弹簧滑过去：出发鼓起、途中按速度横向拉伸纵向压扁，停下回弹到原形。

import { Tabs as TabsPrimitive } from "radix-ui";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { prefersReducedMotion } from "@/components/ui/glass-motion";
import { cn } from "@/lib/utils";

/** 约 0.25s 到位、带一点回弹 */
const SLIDE_SPRING = { stiffness: 520, damping: 34, restDelta: 0.05, restSpeed: 2 };
/** 鼓起包络：鼓大、保持、回落（毫秒） */
const LIFT_IN_MS = 70;
const LIFT_HOLD_MS = 110;
const LIFT_OUT_MS = 220;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** 速度到形变的换算与上限 */
const STRETCH_PER_SPEED = 1 / 5000;
const STRETCH_MAX = 0.22;
const LIFT_SCALE = 0.32;
/** 透镜放大倍率与边缘弯折强度 */
const LENS_ZOOM = 0.14;
const LENS_EDGE = 0.1;

const lensMapCache = new Map<string, string>();

/**
 * 透镜位移贴图：R/G 通道编码每个像素的采样偏移（128 为不偏移）。
 * 中心向内采样 → 放大；靠近胶囊边缘偏移陡增 → 边缘弯折。返回 data URL 与位移幅度。
 */
function lensMap(w: number, h: number): { href: string; scale: number } {
  const scale = Math.max(w, h) * (LENS_ZOOM + LENS_EDGE);
  const key = `${w}x${h}`;
  const cached = lensMapCache.get(key);
  if (cached !== undefined) return { href: cached, scale };
  const W = Math.max(2, Math.round(w));
  const H = Math.max(2, Math.round(h));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { href: "", scale: 0 };
  const img = ctx.createImageData(W, H);
  const r = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 到胶囊中轴线的距离，归一化到 0（中心）~1（边缘）
      const cx = Math.min(Math.max(x + 0.5, r), W - r);
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - r;
      const d = Math.min(1, Math.hypot(dx, dy) / r);
      const edge = d ** 4 * LENS_EDGE;
      // 采样点朝中心收（放大）；水平方向用相对整颗胶囊中心的位置
      const ox =
        -((x + 0.5 - W / 2) / Math.max(W, H)) * LENS_ZOOM - (dx / r) * edge * (r / Math.max(W, H));
      const oy =
        -((y + 0.5 - r) / Math.max(W, H)) * LENS_ZOOM - (dy / r) * edge * (r / Math.max(W, H));
      const i = (y * W + x) * 4;
      img.data[i] = Math.round(128 + (255 * (ox * Math.max(W, H))) / scale);
      img.data[i + 1] = Math.round(128 + (255 * (oy * Math.max(W, H))) / scale);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const href = canvas.toDataURL();
  lensMapCache.set(key, href);
  return { href, scale };
}

function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      className={cn("flex flex-col gap-3", className)}
      data-slot="tabs"
      {...props}
    />
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function TabsList({ className, children, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const lensRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const filterId = `${useId().replace(/[^a-zA-Z0-9-]/g, "")}-lens`;
  const lens = box && typeof document !== "undefined" ? lensMap(box.w, box.h) : null;

  // 动画状态：x 用弹簧（半隐式欧拉，自带速度）；鼓起是按时间的包络（快速鼓大 → 保持 → 回落）
  const anim = useRef({ x: 0, v: 0, target: 0, liftStart: -1, raf: 0, last: 0 });

  const apply = useCallback((lift: number) => {
    const a = anim.current;
    const stretch = Math.min(STRETCH_MAX, Math.abs(a.v) * STRETCH_PER_SPEED);
    const sx = 1 + stretch + lift * LIFT_SCALE;
    const sy = 1 - stretch * 0.45 + lift * LIFT_SCALE;
    const transform = `translate3d(${a.x}px,0,0) scale(${sx},${sy})`;
    if (dropRef.current) dropRef.current.style.transform = transform;
    if (lensRef.current) {
      lensRef.current.style.transform = transform;
      // 静止时透镜隐去，文字清晰；滑动、鼓起时显现
      lensRef.current.style.opacity = String(Math.min(1, stretch / (STRETCH_MAX * 0.5) + lift));
    }
  }, []);

  const tick = useCallback(
    (now: number) => {
      const a = anim.current;
      const dt = Math.min((now - a.last) / 1000, 1 / 30);
      a.last = now;
      const accel = -SLIDE_SPRING.stiffness * (a.x - a.target) - SLIDE_SPRING.damping * a.v;
      a.v += accel * dt;
      a.x += a.v * dt;
      const t = Math.max(0, now - a.liftStart);
      const lift =
        t < LIFT_IN_MS
          ? easeOut(t / LIFT_IN_MS)
          : t < LIFT_IN_MS + LIFT_HOLD_MS
            ? 1
            : Math.max(0, 1 - easeInOut((t - LIFT_IN_MS - LIFT_HOLD_MS) / LIFT_OUT_MS));
      const settled =
        Math.abs(a.x - a.target) < SLIDE_SPRING.restDelta &&
        Math.abs(a.v) < SLIDE_SPRING.restSpeed &&
        lift === 0;
      if (settled) {
        a.x = a.target;
        a.v = 0;
        a.raf = 0;
        apply(0);
        return;
      }
      apply(lift);
      a.raf = requestAnimationFrame(tick);
    },
    [apply],
  );

  const ready = useRef(false);
  // 用 offset* 取选中项在轨道内边距盒中的位置，和绝对定位的参照系一致，指示器正好居中压在选中项上
  const measure = useCallback(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[data-state="active"]');
    if (!list || !active) return;
    const next = {
      x: active.offsetLeft,
      y: active.offsetTop,
      w: active.offsetWidth,
      h: active.offsetHeight,
    };
    setBox((b) =>
      b && b.y === next.y && b.w === next.w && b.h === next.h ? b : { ...next, x: 0 },
    );
    const a = anim.current;
    a.target = next.x;
    if (!ready.current || prefersReducedMotion()) {
      ready.current = true;
      cancelAnimationFrame(a.raf);
      a.raf = 0;
      a.x = next.x;
      a.v = 0;
      apply(0);
      return;
    }
    if (Math.abs(a.x - next.x) < 0.5) return;
    a.liftStart = performance.now();
    if (!a.raf) {
      a.last = performance.now();
      a.raf = requestAnimationFrame(tick);
    }
  }, [apply, tick]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const list = listRef.current;
    const mo = new MutationObserver(measure);
    const ro = new ResizeObserver(() => {
      ready.current = false;
      measure();
    });
    if (list) {
      mo.observe(list, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
      ro.observe(list);
    }
    const a = anim.current;
    return () => {
      mo.disconnect();
      ro.disconnect();
      cancelAnimationFrame(a.raf);
    };
  }, [measure]);

  return (
    <TabsPrimitive.List
      className={cn(
        "relative isolate inline-flex rounded-full p-[3px]",
        // 轨道：比所在玻璃面略深一点、向内凹，和上面的水滴形成对比
        "bg-black/[0.05] shadow-[inset_0_1px_2px_rgb(0_0_0/0.08),inset_0_0_0_0.5px_rgb(0_0_0/0.05)]",
        "dark:bg-white/[0.06] dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.4),inset_0_0_0_0.5px_rgb(255_255_255/0.06)]",
        className,
      )}
      data-slot="tabs-list"
      ref={listRef}
      {...props}
    >
      {box && (
        <div
          aria-hidden="true"
          className={cn(
            "glass-drop pointer-events-none absolute left-0 z-0 rounded-full will-change-transform",
          )}
          ref={dropRef}
          style={{
            top: box.y,
            width: box.w,
            height: box.h,
            transform: `translate3d(${anim.current.x}px,0,0)`,
          }}
        />
      )}
      {children}
      {box && lens?.href ? (
        <>
          <svg aria-hidden="true" className="absolute h-0 w-0" focusable="false">
            <defs>
              <filter
                colorInterpolationFilters="sRGB"
                filterUnits="objectBoundingBox"
                height="1"
                id={filterId}
                primitiveUnits="userSpaceOnUse"
                width="1"
                x="0"
                y="0"
              >
                <feImage
                  height={box.h}
                  href={lens.href}
                  preserveAspectRatio="none"
                  result="map"
                  width={box.w}
                  x="0"
                  y="0"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="map"
                  scale={lens.scale}
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>
            </defs>
          </svg>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 z-20 rounded-full will-change-transform"
            ref={lensRef}
            style={{
              top: box.y,
              width: box.w,
              height: box.h,
              opacity: 0,
              transform: `translate3d(${anim.current.x}px,0,0)`,
              backdropFilter: `url(#${filterId})`,
              WebkitBackdropFilter: `url(#${filterId})`,
              boxShadow:
                "inset 0 1px 0.5px rgb(255 255 255 / 0.9), inset 0 0 0 0.5px rgb(255 255 255 / 0.5)",
            }}
          />
        </>
      ) : null}
    </TabsPrimitive.List>
  );
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative z-10 inline-flex cursor-pointer items-center justify-center gap-[6px] whitespace-nowrap rounded-full px-[14px] py-[8px] font-medium text-[#727274] text-sm leading-none transition-colors duration-150 hover:text-[#4a4a4c] focus-visible:shadow-[0_0_0_2px_#9896ff] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-black dark:text-[#8f8e8e] dark:hover:text-[#cfcfcf] dark:data-[state=active]:text-white",
        className,
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("focus-visible:outline-none", className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
