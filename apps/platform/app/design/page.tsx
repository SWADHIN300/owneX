import type { Metadata } from "next";
import Link from "next/link";

import { BrandLockup } from "@/components/brand";
import { DesignSystemGallery } from "@/components/design-system-gallery";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Design system — owneX",
  description:
    "Every component in the owneX design system, in light and dark, with the six named gradients.",
};

/**
 * Living reference for the design system. Phase 5 builds the dashboard against
 * these components, so this page is the place to check a state exists and behaves
 * before wiring it to a contract.
 */
export default function DesignSystemPage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 glass border-b border-border">
        <div className="page-container flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="owneX home" className="rounded-sm">
              <BrandLockup />
            </Link>
            <span className="label-xs hidden text-ink-faint sm:inline">
              Design system
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="page-container flex-1 py-12">
        <div className="mb-12 max-w-2xl">
          <h1 className="display-sm mb-3 text-3xl font-semibold text-ink sm:text-4xl">
            Design system
          </h1>
          <p className="text-base leading-relaxed text-ink-muted">
            Thirteen components on a token layer that flips cleanly between light
            and dark. Toggle the theme in the header to check both.
          </p>
        </div>

        <DesignSystemGallery />
      </main>
    </div>
  );
}
