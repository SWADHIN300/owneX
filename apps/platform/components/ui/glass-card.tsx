import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export type CardGradient =
  | "none"
  | "dawn"
  | "aurora"
  | "deep"
  | "canopy"
  | "sand"
  | "dusk";

const GRADIENT: Record<CardGradient, string> = {
  none: "",
  dawn: "gradient-dawn",
  aurora: "gradient-aurora",
  deep: "gradient-deep",
  canopy: "gradient-canopy",
  sand: "gradient-sand",
  dusk: "gradient-dusk",
};

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Frosted translucent surface instead of a solid one. */
  glass?: boolean;
  gradient?: CardGradient;
  /** Raises the card on hover. Skipped under reduced motion. */
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const PADDING = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
} as const;

export function GlassCard({
  glass = false,
  gradient = "none",
  interactive = false,
  padding = "md",
  className,
  children,
  ...props
}: GlassCardProps) {
  const onGradient = gradient !== "none";

  return (
    <div
      data-slot="glass-card"
      className={cn(
        "rounded-xl border border-border shadow-card",
        glass ? "frosted" : onGradient ? "" : "bg-surface",
        GRADIENT[gradient],
        // Gradients aurora, deep, canopy and dusk are dark in both themes, so
        // their content needs light ink regardless of mode.
        (gradient === "aurora" ||
          gradient === "deep" ||
          gradient === "canopy" ||
          gradient === "dusk") &&
          "border-white/12 text-white",
        interactive &&
          "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lifted motion-reduce:hover:translate-y-0",
        PADDING[padding],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
