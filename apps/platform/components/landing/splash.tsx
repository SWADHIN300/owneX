"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { Wordmark } from "@/components/brand";
import { useMounted } from "@/lib/use-mounted";

/**
 * Entry splash: the wordmark centred on the canvas while the page settles, then
 * it lifts away.
 *
 * Deliberately short and deliberately once per session. A splash that reappears
 * on every navigation is an obstacle, not a brand moment, so the fact it has
 * played is remembered in sessionStorage.
 *
 * It never blocks the page. The content underneath is already rendered and
 * readable to a crawler or a screen reader; this only sits on top, is marked
 * `aria-hidden`, and is skipped entirely under reduced motion.
 *
 * Eligibility is derived, not assigned in an effect. The only state is whether
 * the hold has elapsed, and that flips inside the timer callback, which keeps the
 * render path free of cascading updates.
 */
const STORAGE_KEY = "ownex.splash.seen";
const HOLD_MS = 900;

export function Splash() {
  const mounted = useMounted();
  const reduceMotion = useReducedMotion();
  const [elapsed, setElapsed] = React.useState(false);

  const eligible = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    if (reduceMotion) return false;
    try {
      return sessionStorage.getItem(STORAGE_KEY) !== "1";
    } catch {
      // Private mode can throw. Skipping the splash is the safe fallback.
      return false;
    }
  }, [reduceMotion]);

  React.useEffect(() => {
    if (!mounted || !eligible || elapsed) return;
    const timer = window.setTimeout(() => {
      setElapsed(true);
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // Ignore: it will simply play again on the next load.
      }
    }, HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [mounted, eligible, elapsed]);

  const visible = mounted && eligible && !elapsed;

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          aria-hidden
          className="fixed inset-0 z-100 flex items-center justify-center bg-background"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.04 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <Wordmark className="text-4xl text-brand sm:text-5xl" />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
