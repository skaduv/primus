"use client";

import { Copy, Minus, Square, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { type WindowControls as Controls, getWindowControls } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

const t = strings.layout;

/**
 * 拖动区属性：主窗口没有系统标题栏，带这个属性的元素按住可拖动窗口、双击最大化/还原。
 * 只对元素自身生效（不含子元素），子元素里的纯文字要加 pointer-events-none 才不挡拖动。
 */
export const dragRegion = { "data-tauri-drag-region": "" } as const;

function CaptionButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-8 w-10 items-center justify-center rounded-[10px] text-muted transition-colors",
        "hover:text-fg focus-visible:outline-2 focus-visible:outline-accent",
        danger
          ? "hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/80"
          : "hover:bg-hover active:bg-hover/60",
      )}
    >
      {children}
    </button>
  );
}

/**
 * 自绘的窗口按钮（最小化 · 最大化/还原 · 关闭），放在顶栏最右侧，让标题栏与界面连成一体。
 * 浏览器预览没有窗口控制，不渲染。
 */
export function WindowControls({ className }: { className?: string }) {
  const [controls, setControls] = useState<Controls>();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getWindowControls().then(async (c) => {
      if (disposed || !c) return;
      setControls(c);
      const off = await c.onMaximizedChange(setMaximized);
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!controls) return null;

  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", className)}>
      <CaptionButton label={t.minimize} onClick={() => void controls.minimize()}>
        <Minus aria-hidden size={15} strokeWidth={1.5} />
      </CaptionButton>
      <CaptionButton
        label={maximized ? t.restore : t.maximize}
        onClick={() => void controls.toggleMaximize()}
      >
        {maximized ? (
          <Copy aria-hidden size={13} strokeWidth={1.5} className="-scale-x-100" />
        ) : (
          <Square aria-hidden size={12} strokeWidth={1.5} />
        )}
      </CaptionButton>
      <CaptionButton label={t.close} danger onClick={() => void controls.close()}>
        <X aria-hidden size={16} strokeWidth={1.5} />
      </CaptionButton>
    </div>
  );
}

/** 没有自己顶栏的页面用的细标题栏：整条可拖动，右侧是窗口按钮 */
export function WindowTitleBar({ className }: { className?: string }) {
  return (
    <div {...dragRegion} className={cn("flex shrink-0 items-center justify-end px-1", className)}>
      <WindowControls />
    </div>
  );
}
