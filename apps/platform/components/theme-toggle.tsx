"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTheme } from "next-themes";

import { cn } from "@/lib/cn";
import { useMounted } from "@/lib/use-mounted";

/**
 * Light and dark switch. Renders at a fixed size before mount so the server and
 * client markup match, then resolves the icons once hydrated.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  const mounted = useMounted();

  const isDark = mounted ? resolvedTheme === "dark" : false;
  const nextMode = isDark ? "light" : "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={mounted ? `Switch to ${nextMode} theme` : "Switch theme"}
      onClick={() => setTheme(nextMode)}
      className={cn(
        "relative inline-flex h-9 w-16 shrink-0 items-center rounded-full border border-border bg-surface-2 p-1",
        "transition-colors duration-200 hover:border-brand-line",
        className,
      )}
    >
      <motion.span
        aria-hidden
        className="absolute size-7 rounded-full bg-brand"
        animate={{ left: isDark ? "2rem" : "0.25rem" }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 520, damping: 34 }
        }
      />
      <span
        aria-hidden
        className="relative z-10 flex w-full items-center justify-between px-1.5"
      >
        <SunIcon
          className={cn("size-3.5", isDark ? "text-ink-faint" : "text-brand-ink")}
        />
        <MoonIcon
          className={cn("size-3.5", isDark ? "text-brand-ink" : "text-ink-faint")}
        />
      </span>
    </button>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
    </svg>
  );
}
