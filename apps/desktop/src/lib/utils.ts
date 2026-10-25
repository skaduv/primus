// 拼接 className（shadcn 约定的 cn）。不做 Tailwind 冲突合并：
// 组件约定把调用方的 className 放在最后，需要覆盖时由调用方写更具体的类。
export type ClassValue = string | false | null | undefined;

export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
