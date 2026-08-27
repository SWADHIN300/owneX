"use client";

import { BrandLockup } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { NetworkChip } from "@/components/ui";

const NAV = [
  { label: "Platform", href: "#how-it-works" },
  { label: "Security", href: "#evidence" },
  // { label: "Design", href: "/design" },
];

/**
 * Topbar. Every control lives on the bar itself: brand, the full set of links,
 * chain state, the theme switch, and both actions. Nothing is hidden behind a menu
 * button at any width.
 *
 * Below the medium breakpoint the bar keeps all of it and becomes two rows, with
 * the links in a horizontally scrollable strip. That is the honest trade at 390px:
 * the alternative is the hamburger this is meant to avoid.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 bar-surface">
      <div className="page-container flex h-16 items-center gap-5">
        <a href="#top" aria-label="owneX home" className="shrink-0 rounded-sm">
          <BrandLockup />
        </a>

        <nav aria-label="Main" className="hidden min-w-0 md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="block rounded-md px-3 py-2 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-ink-muted transition-colors duration-200 hover:bg-brand-soft hover:text-ink"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-2.5">
          <NetworkChip
            chainId={31337}
            expectedChainId={31337}
            className="hidden lg:inline-flex"
          />

          <ThemeToggle />

          <a
            href="#evidence"
            className="hidden rounded-full border border-border px-4 py-2.5 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-ink transition-colors duration-200 hover:bg-brand-soft sm:inline-flex"
          >
            Docs
          </a>

          <a
            href="#how-it-works"
            className="rounded-full bg-brand px-5 py-2.5 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-brand-ink transition-colors duration-200 hover:bg-brand-hover"
          >
            Get started
          </a>
        </div>
      </div>

      {/* Links stay visible below md, in a scrollable strip rather than a menu. */}
      <nav aria-label="Sections" className="border-t border-border/60 md:hidden">
        <ul className="page-container flex items-center gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV.map((item) => (
            <li key={item.href} className="shrink-0">
              <a
                href={item.href}
                className="block rounded-md px-2.5 py-1.5 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-ink-muted transition-colors duration-200 hover:bg-brand-soft hover:text-ink"
              >
                {item.label}
              </a>
            </li>
          ))}
          <li className="shrink-0 ps-1">
            <NetworkChip chainId={31337} expectedChainId={31337} />
          </li>
        </ul>
      </nav>
    </header>
  );
}
