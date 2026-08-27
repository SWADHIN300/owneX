"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/cn";
import { BrandLockup } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, NetworkChip } from "@/components/ui";

const NAV = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Split", href: "#split" },
  { label: "Capabilities", href: "#capabilities" },
  { label: "Evidence", href: "#evidence" },
];

export function SiteHeader() {
  const [lifted, setLifted] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-300",
        lifted ? "glass border-border" : "border-transparent bg-transparent",
      )}
    >
      <div className="page-container flex h-16 items-center justify-between gap-4">
        <a href="#top" aria-label="owneX home" className="rounded-sm">
          <BrandLockup />
        </a>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-muted transition-colors duration-200 hover:bg-brand-soft hover:text-ink"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          {/* Local chain is what the project runs against today. */}
          <NetworkChip chainId={31337} expectedChainId={31337} className="hidden sm:inline-flex" />
          <ThemeToggle />
          <Button size="sm" className="hidden sm:inline-flex">
            Connect wallet
          </Button>

          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((value) => !value)}
            className="inline-flex size-10 items-center justify-center rounded-full border border-border text-ink transition-colors duration-200 hover:bg-brand-soft lg:hidden"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
            </svg>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            id="site-menu"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }}
            className="overflow-hidden border-t border-border bg-surface lg:hidden"
          >
            <ul className="page-container flex flex-col py-2">
              {NAV.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-md px-2 py-3 text-base font-medium text-ink transition-colors duration-200 hover:bg-brand-soft"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
              <li className="px-2 py-3">
                <Button fullWidth>Connect wallet</Button>
              </li>
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
