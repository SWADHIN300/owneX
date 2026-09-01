"use client";

/**
 * Root error boundary.
 *
 * Without this file a thrown server component renders Next.js' bare
 * "This page couldn't load / A server error occurred" screen, which carries no
 * digest and no route — the reason a 500 on /authorize took a log trawl to find.
 * The digest shown here is the same value Vercel logs, so a report can be matched
 * to its stack trace directly.
 */

import Link from "next/link";
import { Button, GlassCard } from "@/components/ui";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <GlassCard padding="lg" className="w-full max-w-md border-danger/40 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/15 text-danger">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm text-ink-muted leading-relaxed">
          This page failed to render. The problem has been logged.
        </p>
        {error.digest && (
          <p className="mt-3 rounded-lg border border-border-soft bg-surface/30 p-2.5 text-left text-[11px] leading-relaxed text-ink-faint">
            Reference
            <br />
            <span className="font-mono font-semibold text-ink">{error.digest}</span>
          </p>
        )}
        <div className="mt-6 flex items-center gap-3">
          <Button variant="primary" className="flex-1" onClick={reset}>
            Try again
          </Button>
          <Link href="/" className="flex-1">
            <Button variant="secondary" className="w-full">
              Return home
            </Button>
          </Link>
        </div>
      </GlassCard>
    </main>
  );
}
