import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/utils";

/** 设置中心统一控件样式：克制圆角、细腻描边与微按压反馈 */
export const settingsButtonClass =
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-surface px-3 text-sm font-medium text-fg shadow-[0_1px_2px_rgb(0_0_0/0.05)] ring-1 ring-inset ring-black/[0.09] transition-[background-color,color,box-shadow,transform,opacity] duration-150 enabled:hover:bg-black/[0.03] enabled:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none dark:bg-white/[0.07] dark:shadow-none dark:ring-white/[0.1] dark:enabled:hover:bg-white/[0.12]";

export const settingsPrimaryButtonClass =
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-fg px-3.5 text-sm font-medium text-surface shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-[opacity,transform] duration-150 enabled:hover:opacity-90 enabled:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none";

export const settingsDangerButtonClass =
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-danger/[0.07] px-3 text-sm font-medium text-danger ring-1 ring-inset ring-danger/20 transition-[background-color,transform,opacity] duration-150 enabled:hover:bg-danger/[0.13] enabled:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/45 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none dark:bg-danger/[0.12] dark:ring-danger/25 dark:enabled:hover:bg-danger/[0.18]";

export const settingsIconButtonClass =
  "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-[background-color,color,transform] duration-150 enabled:hover:bg-hover enabled:hover:text-fg enabled:active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none";

export const settingsInputClass =
  "w-full min-w-0 rounded-lg bg-black/[0.025] px-3 py-2 text-sm text-fg shadow-[inset_0_1px_1px_rgb(0_0_0/0.03)] outline-none ring-1 ring-inset ring-black/[0.08] transition-[box-shadow,background-color] duration-150 placeholder:text-muted/80 focus:bg-surface focus:ring-2 focus:ring-accent/45 aria-[invalid=true]:ring-danger/60 disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none dark:bg-white/[0.05] dark:shadow-none dark:ring-white/[0.1] dark:focus:bg-white/[0.08]";

/** 设置分组共用统一卡片表面，标题克制柔和、行间以极细分割线区隔。 */
export function Section({
  title,
  description,
  action,
  className,
  contentClassName,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h3 className="text-xs font-medium tracking-wide text-muted">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted/80">{description}</p>}
        </div>
        {action}
      </div>
      <div
        className={cn(
          "settings-card divide-y divide-black/[0.055] overflow-hidden rounded-2xl dark:divide-white/[0.06]",
          contentClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function Row({
  label,
  hint,
  badge,
  icon,
  labelId,
  interactive = false,
  className,
  children,
}: {
  label: string;
  hint?: string;
  badge?: ReactNode;
  icon?: IconName;
  labelId?: string;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[56px] flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-4 py-3.5",
        interactive &&
          "transition-colors duration-150 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]",
        className,
      )}
    >
      <div className="flex min-w-36 flex-1 items-center gap-3">
        {icon && (
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-black/[0.035] text-muted ring-1 ring-inset ring-black/[0.04] dark:bg-white/[0.06] dark:ring-white/[0.07]"
          >
            <Icon name={icon} size="sm" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p id={labelId} className="text-sm font-medium text-fg">
              {label}
            </p>
            {badge}
          </div>
          {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** 精致定制样式的原生下拉选择框：保留完整的无障碍 combobox 语义与键盘交互。 */
export function SettingsSelect({
  className,
  wrapperClassName,
  disabled,
  children,
  ...props
}: ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <div className={cn("relative inline-flex max-w-full shrink-0 items-center", wrapperClassName)}>
      <select
        disabled={disabled}
        className={cn(
          "settings-select h-8 max-w-full cursor-pointer appearance-none rounded-lg bg-surface py-1 pr-8 pl-3 text-sm font-medium text-fg shadow-[0_1px_2px_rgb(0_0_0/0.05)] outline-none ring-1 ring-inset ring-black/[0.09] transition-[background-color,box-shadow,color] duration-150 hover:bg-black/[0.03] focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:bg-black/[0.03] disabled:text-muted disabled:shadow-none disabled:hover:bg-black/[0.03] motion-reduce:transition-none dark:bg-white/[0.07] dark:shadow-none dark:ring-white/[0.1] dark:hover:bg-white/[0.11] dark:disabled:bg-white/[0.03] dark:disabled:hover:bg-white/[0.03]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <Icon
        name="chevron-down"
        size="xs"
        className="pointer-events-none absolute right-2.5 text-muted"
      />
    </div>
  );
}

const STATUS_TONES = {
  neutral: {
    pill: "bg-black/[0.045] text-muted ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.08]",
    dot: "bg-muted",
  },
  success: {
    pill: "bg-success/[0.1] text-success ring-success/20 dark:bg-success/[0.14] dark:ring-success/25",
    dot: "bg-success",
  },
  danger: {
    pill: "bg-danger/[0.09] text-danger ring-danger/20 dark:bg-danger/[0.14] dark:ring-danger/25",
    dot: "bg-danger",
  },
  warning: {
    pill: "bg-warning/[0.1] text-warning ring-warning/20 dark:bg-warning/[0.14] dark:ring-warning/25",
    dot: "bg-warning",
  },
} as const;

/** 带柔光状态点的精巧状态胶囊（圆点标记 aria-hidden 且不含文本，不影响 status 文本读取） */
export function StatusPill({
  tone = "neutral",
  role,
  className,
  children,
}: {
  tone?: keyof typeof STATUS_TONES;
  role?: "status";
  className?: string;
  children: ReactNode;
}) {
  const styles = STATUS_TONES[tone];
  return (
    <span
      role={role}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        styles.pill,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", styles.dot)} />
      {children}
    </span>
  );
}

/** 柔和提示/错误横幅 */
export function SettingsAlert({
  title,
  message,
  tone = "danger",
  role = "alert",
  className,
}: {
  title?: string;
  message?: ReactNode;
  tone?: "danger" | "neutral";
  role?: "alert" | "status";
  className?: string;
}) {
  const danger = tone === "danger";
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm ring-1 ring-inset",
        danger
          ? "bg-danger/[0.06] text-danger ring-danger/20 dark:bg-danger/[0.1] dark:ring-danger/25"
          : "bg-black/[0.03] text-fg ring-black/[0.06] dark:bg-white/[0.05] dark:ring-white/[0.08]",
        className,
      )}
    >
      <Icon
        name={danger ? "alert-circle" : "check-circle"}
        size="sm"
        className={cn("mt-0.5 shrink-0", danger ? "text-danger" : "text-success")}
      />
      <div className="min-w-0 flex-1">
        {title && <p className={cn("font-medium", danger ? "text-danger" : "text-fg")}>{title}</p>}
        {message && (
          <p
            className={cn(
              "whitespace-pre-wrap break-words",
              title ? "mt-0.5 text-xs text-muted" : "",
            )}
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
