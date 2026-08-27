"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/cn";
import { BrandLockup } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { NetworkChip } from "@/components/ui";

const NAV = [
  { label: "How it works", href: "#how-it-works" },
  { label: "The split", href: "#split" },
  { label: "Capabilities", href: "#capabilities" },
  { label: "Evidence", href: "#evidence" },
];

/**
 * Minimal header, following the reference: brand on the left, one dark pill
 * action and a menu button on the right. Everything else lives behind the menu,
 * so the hero type has the viewport to itself.
 */
export function SiteHeader() {
  const [open, setOpen] = React.useState(false);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="absolute inset-x-0 top-0 z-40">
      <div className="page-container flex h-20 items-center justify-between gap-4">
        <a href="#top" aria-label="owneX home" className="rounded-sm">
          <BrandLockup />
        </a>

        <div className="flex items-center gap-2.5">
          <a
            href="#how-it-works"
            className="rounded-full bg-ink px-6 py-3 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-background transition-opacity duration-200 hover:opacity-90"
          >
            Get started
          </a>

          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((value) => !value)}
            className="inline-flex size-11 items-center justify-center rounded-full bg-ink text-background transition-opacity duration-200 hover:opacity-90"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {open ? (
                <path d="M5 5l10 10M15 5L5 15" />
              ) : (
                <path d="M3.5 7.5h13M3.5 12.5h13" />
              )}
            </svg>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            id="site-menu"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
            transition={{ duration: reduceMotion ? 0 : 0.24, ease: "easeOut" }}
            className="page-container"
          >
            <div className="glass rounded-2xl border border-border p-3 shadow-lifted">
              <ul className="flex flex-col">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center justify-between rounded-xl px-4 py-3.5",
                        "font-mono text-xs uppercase tracking-[0.1em] text-ink",
                        "transition-colors duration-200 hover:bg-brand-soft",
                      )}
                    >
                      {item.label}
                      <span aria-hidden className="text-accent">
                        &rarr;
                      </span>
                    </a>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border-soft px-4 pt-4">
                <NetworkChip chainId={31337} expectedChainId={31337} />
                <ThemeToggle />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
