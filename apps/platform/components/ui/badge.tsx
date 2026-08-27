import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "accent"
  | "data"
  | "success"
  | "warn"
  | "danger";

const TONE: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface-2 text-ink-muted",
  brand: "border-brand-line bg-brand-soft text-brand",
  accent: "border-brand-line bg-brand-soft text-accent",
  data: "border-data/35 bg-data/10 text-data",
  success: "border-success/35 bg-success/10 text-success",
  warn: "border-warn/35 bg-warn/10 text-warn",
  danger: "border-danger/35 bg-danger/10 text-danger",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Monospace, for protocol values such as ERC-721 or a block number. */
  mono?: boolean;
  leadingIcon?: ReactNode;
}

export function Badge({
  tone = "neutral",
  mono = false,
  leadingIcon,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "text-[0.6875rem] leading-none font-medium whitespace-nowrap",
        mono && "font-mono",
        TONE[tone],
        className,
      )}
      {...props}
    >
      {leadingIcon}
      {children}
    </span>
  );
}
