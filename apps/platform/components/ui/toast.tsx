"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/cn";

export type ToastTone = "info" | "success" | "warn" | "danger";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  /** Milliseconds before auto dismiss. 0 keeps it until dismissed. */
  duration: number;
}

type ToastInput = Omit<Partial<Toast>, "id"> & { title: string };

interface ToastContextValue {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const TONE_STYLE: Record<ToastTone, string> = {
  info: "border-brand-line",
  success: "border-success/45",
  warn: "border-warn/45",
  danger: "border-danger/45",
};

const TONE_BAR: Record<ToastTone, string> = {
  info: "bg-brand",
  success: "bg-success",
  warn: "bg-warn",
  danger: "bg-danger",
};

/**
 * Toast notifications.
 *
 * Messages render into a polite live region so a screen reader announces them
 * without stealing focus. Errors use `assertive`, because a failed transaction
 * should interrupt. Timers pause while the pointer is over the stack so a message
 * cannot vanish mid-read.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const timers = React.useRef(new Map<string, number>());
  const reduceMotion = useReducedMotion();

  const dismiss = React.useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const schedule = React.useCallback(
    (id: string, duration: number) => {
      if (duration <= 0) return;
      const timer = window.setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const toast = React.useCallback(
    (input: ToastInput) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const next: Toast = {
        id,
        title: input.title,
        description: input.description,
        tone: input.tone ?? "info",
        duration: input.duration ?? 5000,
      };
      setToasts((current) => [...current.slice(-3), next]);
      schedule(id, next.duration);
      return id;
    },
    [schedule],
  );

  // Clear every pending timer if the provider unmounts.
  React.useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) window.clearTimeout(timer);
      map.clear();
    };
  }, []);

  const pauseAll = () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  };

  const resumeAll = () => {
    for (const item of toasts) {
      if (!timers.current.has(item.id)) schedule(item.id, item.duration);
    }
  };

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        data-slot="toast-viewport"
        onPointerEnter={pauseAll}
        onPointerLeave={resumeAll}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-60 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        <AnimatePresence initial={false}>
          {toasts.map((item) => (
            <motion.div
              key={item.id}
              role={item.tone === "danger" ? "alert" : "status"}
              aria-live={item.tone === "danger" ? "assertive" : "polite"}
              layout={!reduceMotion}
              initial={
                reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }
              }
              transition={{
                duration: reduceMotion ? 0 : 0.24,
                ease: [0.22, 1, 0.36, 1],
              }}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm gap-3 overflow-hidden rounded-md border bg-surface p-3.5 shadow-lifted",
                TONE_STYLE[item.tone],
              )}
            >
              <span
                aria-hidden
                className={cn("w-0.5 shrink-0 rounded-full", TONE_BAR[item.tone])}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                    {item.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label={`Dismiss: ${item.title}`}
                className="inline-flex size-7 shrink-0 items-center justify-center self-start rounded-sm text-ink-faint transition-colors duration-200 hover:bg-surface-2 hover:text-ink"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}
