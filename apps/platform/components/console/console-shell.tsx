"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";
import { CHAIN, shortAddress } from "@/lib/wallet";
import { BrandLockup } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { ConnectButton } from "@/components/wallet/connect-button";
import { useWallet } from "@/components/wallet/wallet-provider";
import { RpcFailurePanel, technicalDetail } from "@/components/console/states";
import {
  Badge,
  GlassCard,
  Identicon,
  NetworkChip,
  RoleChip,
  Skeleton,
  SkeletonLabel,
  type Role,
} from "@/components/ui";

/**
 * Console navigation.
 *
 * `soon` marks a route that is not built. It renders as inert text with a badge
 * rather than a link, because a nav entry that navigates to a blank screen is
 * worse than one that admits it is not ready. Everything listed here now exists;
 * the flag stays in the type for the Phase 6 entries.
 */
const NAV: Array<{ label: string; href: string; soon?: boolean }> = [
  { label: "Overview", href: "/dashboard" },
  { label: "My identity", href: "/dashboard/identity" },
  { label: "Members", href: "/dashboard/members" },
  { label: "Roles", href: "/dashboard/roles" },
  { label: "Assets", href: "/dashboard/assets" },
  { label: "Applications", href: "/dashboard/applications" },
  { label: "Audit", href: "/dashboard/audit" },
];

/**
 * Which nav entry is the current one.
 *
 * Overview is an exact match only. Every other entry also matches its children,
 * so an asset detail page keeps "Assets" marked as the current section instead of
 * leaving nothing highlighted.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Console shell.
 *
 * Three states are handled before any screen renders, because each needs a
 * different action from the user and conflating them is how dashboards end up
 * showing an empty table when the real problem is that nobody is signed in:
 *
 *   loading   the session check has not finished
 *   signed out  no valid cookie, so offer sign-in
 *   no org      signed in but not a member of anything
 */
export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const { ready, session, sessionError, wrongChain, chainId, fixChain } = useWallet();
  const pathname = usePathname();

  if (!ready) return <ShellSkeleton />;
  // Being signed out and being unable to ask are different problems. Showing
  // "sign in to continue" when the server could not reach the chain sends the
  // user to re-sign a session they already have, which cannot work and tells
  // them nothing.
  if (!session && sessionError !== null) return <ShellFailure error={sessionError} />;
  if (!session) return <SignedOut />;

  const activeRole = (session.memberships.find(
    (m) => m.orgId === session.activeOrgId,
  )?.role ?? "NONE") as Role;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bar-surface sticky top-0 z-40">
        <div className="page-container flex h-16 items-center gap-4">
          <Link href="/" aria-label="owneX home" className="shrink-0 rounded-sm">
            <BrandLockup />
          </Link>
          <span className="label-xs hidden text-ink-faint sm:inline">Console</span>

          <div className="ms-auto flex items-center gap-2.5">
            <NetworkChip
              chainId={chainId ?? undefined}
              expectedChainId={CHAIN.id}
              className="hidden md:inline-flex"
            />
            <ThemeToggle />
            <ConnectButton />
          </div>
        </div>
      </header>

      {wrongChain ? (
        <div className="border-b border-warn/40 bg-warn/10">
          <div className="page-container flex flex-wrap items-center justify-between gap-3 py-3">
            <p className="text-sm text-ink">
              Your wallet is on chain {chainId}, but this console reads{" "}
              {CHAIN.name} ({CHAIN.id}). Data shown may not match your wallet.
            </p>
            <button
              type="button"
              onClick={() => void fixChain()}
              className="rounded-full bg-brand px-4 py-2 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-brand-ink"
            >
              Switch network
            </button>
          </div>
        </div>
      ) : null}

      {/* Below lg the sidebar is hidden, so without this there would be no way
          to reach any screen but the one you landed on. A scrolling strip keeps
          all six reachable without a menu to open. */}
      <nav
        aria-label="Console sections"
        className="border-b border-border bg-surface lg:hidden"
      >
        <ul className="page-container flex gap-1 overflow-x-auto py-2">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className="shrink-0">
                {item.soon ? (
                  <span
                    aria-disabled
                    className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm whitespace-nowrap text-ink-faint"
                  >
                    {item.label}
                    <Badge tone="neutral">Soon</Badge>
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors duration-200",
                      active
                        ? "bg-brand-soft font-semibold text-ink"
                        : "text-ink-muted hover:bg-brand-soft hover:text-ink",
                    )}
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="page-container flex flex-1 gap-8 py-8">
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-border bg-surface p-3">
            <Identicon value={session.wallet} size={34} />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-ink">
                {session.profile?.displayName ?? shortAddress(session.wallet)}
              </p>
              <RoleChip role={activeRole} className="mt-1" />
            </div>
          </div>

          <nav aria-label="Console">
            <ul className="flex flex-col gap-0.5">
              {NAV.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    {item.soon ? (
                      <span
                        aria-disabled
                        title="Not built yet"
                        className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm text-ink-faint"
                      >
                        {item.label}
                        <Badge tone="neutral">Soon</Badge>
                      </span>
                    ) : (
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "block rounded-md px-3 py-2.5 text-sm transition-colors duration-200",
                          active
                            ? "bg-brand-soft font-semibold text-ink"
                            : "text-ink-muted hover:bg-brand-soft hover:text-ink",
                        )}
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ShellSkeleton() {
  return (
    <div className="page-container py-16">
      <SkeletonLabel>Checking your session</SkeletonLabel>
      <Skeleton className="mb-4 h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton shape="block" />
        <Skeleton shape="block" />
        <Skeleton shape="block" />
      </div>
    </div>
  );
}

function SignedOut() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* The signed-out state keeps the header: without it there is no way back
          to the site and no indication of which product this is. */}
      <ShellHeader />

      <div className="page-container flex flex-1 items-center justify-center py-24">
        <GlassCard padding="lg" className="max-w-md text-center">
          <h1 className="display-sm mb-3 text-2xl font-semibold text-ink">
            Sign in to continue
          </h1>
          <p className="mb-7 text-sm leading-relaxed text-ink-muted">
            The console reads your role from the chain, so it needs a signature
            from your wallet first. No gas, and no transaction is sent.
          </p>
          <div className="flex justify-center">
            <ConnectButton />
          </div>
          <p className="mt-7 border-t border-border-soft pt-4 text-xs text-ink-faint">
            Expecting {CHAIN.name}. Run{" "}
            <code className="font-mono">npm run dev:chain</code> and{" "}
            <code className="font-mono">npm run seed:all</code> for local data.
          </p>
        </GlassCard>
      </div>
    </div>
  );
}

/**
 * The session could not be read at all.
 *
 * Almost always the chain or the database is unreachable, so the panel says so
 * and names the command that fixes it locally, rather than inviting the user to
 * sign in again — which would fail at the same step for the same reason.
 */
function ShellFailure({ error }: { error: unknown }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <ShellHeader />
      <div className="page-container flex flex-1 items-center justify-center py-24">
        <div className="w-full max-w-lg">
          <RpcFailurePanel
            onRetry={() => window.location.reload()}
            detail={technicalDetail(error)}
          />
        </div>
      </div>
    </div>
  );
}

/** Shared chrome for the states that render instead of the console. */
function ShellHeader() {
  return (
    <header className="bar-surface sticky top-0 z-40">
      <div className="page-container flex h-16 items-center gap-4">
        <Link href="/" aria-label="owneX home" className="shrink-0 rounded-sm">
          <BrandLockup />
        </Link>
        <span className="label-xs hidden text-ink-faint sm:inline">Console</span>
        <div className="ms-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
