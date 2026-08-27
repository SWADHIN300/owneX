import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  shape?: "line" | "block" | "circle";
}

/**
 * Loading placeholder. It is `aria-hidden` and paired with a visually hidden
 * status message by the caller, so screen readers hear "loading" once instead of
 * announcing every grey box.
 */
export function Skeleton({
  shape = "line",
  className,
  ...props
}: SkeletonProps) {
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn(
        "animate-pulse bg-surface-3 motion-reduce:animate-none",
        shape === "line" && "h-3.5 rounded-full",
        shape === "block" && "h-24 rounded-md",
        shape === "circle" && "aspect-square rounded-full",
        className,
      )}
      {...props}
    />
  );
}

/** Screen reader announcement to sit alongside a group of skeletons. */
export function SkeletonLabel({ children = "Loading" }: { children?: string }) {
  return (
    <span role="status" className="sr-only">
      {children}
    </span>
  );
}
