"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * Bottom-left update strip, as in the reference.
 *
 * It is a real dismissible region rather than decoration: it is labelled, the
 * close button has an accessible name, and dismissal is remembered for the
 * session so it does not nag on every navigation.
 */
const STORAGE_KEY = "ownex.notice.phase4";

export function AnnouncementBar() {
  const [visible, setVisible] = React.useState(false);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Private mode can throw; showing the notice is the safe fallback.
    }
    if (!dismissed) {
      const timer = window.setTimeout(() => setVisible(true), 900);
      return () => window.clearTimeout(timer);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Ignore: dismissal simply will not persist.
    }
  };

  return (
    <AnimatePresence>
      {visible ? (
        <motion.aside
          aria-label="Project update"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-4 left-4 z-50 max-w-[calc(100vw-2rem)] sm:max-w-sm"
        >
          <div className="flex items-center gap-3 rounded-full bg-surface py-2 ps-4 pe-2 shadow-lifted ring-1 ring-border">
            <span className="label-xs shrink-0 text-accent">Update</span>
            <p className="min-w-0 flex-1 truncate font-sans text-xs text-ink-muted">
              Phase 4 shipped: design system and landing page.
            </p>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss update"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors duration-200 hover:bg-surface-2 hover:text-ink"
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
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
