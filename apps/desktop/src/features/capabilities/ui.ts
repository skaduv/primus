// 能力中心两个页签共用的样式与文案填充（与设置中心统一）

export const buttonClass =
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-surface/90 px-3 text-sm font-medium text-fg shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-1 ring-inset ring-black/[0.08] transition-[background-color,color,box-shadow,transform,opacity] duration-150 enabled:hover:bg-hover enabled:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none dark:bg-white/[0.06] dark:shadow-none dark:ring-white/[0.1] dark:enabled:hover:bg-white/[0.11]";
export const iconButtonClass =
  "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-[background-color,color,transform] duration-150 enabled:hover:bg-hover enabled:hover:text-fg enabled:active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none";
export const inputClass =
  "w-full min-w-0 rounded-lg bg-surface px-3 py-2 text-sm text-fg shadow-[inset_0_1px_1px_rgb(0_0_0/0.03)] outline-none ring-1 ring-inset ring-black/[0.09] transition-[box-shadow,background-color] duration-150 placeholder:text-muted/80 focus:ring-2 focus:ring-accent/45 aria-[invalid=true]:ring-danger/60 disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none dark:bg-white/[0.05] dark:shadow-none dark:ring-white/[0.1] dark:focus:bg-white/[0.07]";
export const primaryButtonClass =
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-fg px-4 text-sm font-medium text-surface shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-[opacity,transform] duration-150 enabled:hover:opacity-90 enabled:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none";
export const cardClass = "settings-card overflow-hidden rounded-2xl";

export const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));
