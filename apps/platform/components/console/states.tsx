"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/cn";
import { CHAIN } from "@/lib/wallet";
import { ApiRequestError } from "@/lib/api";
import { useWallet } from "@/components/wallet/wallet-provider";
import { Button, GlassCard, Skeleton, SkeletonLabel } from "@/components/ui";

/**
 * The states every console screen has to handle.
 *
 * They live together because the point is that they are distinguishable. A
 * dashboard that renders an empty table for "no data", "you lack permission"
 * and "the chain is unreachable" has told the user nothing and will send them to
 * support for all three. Each panel here names the cause and, where one exists,
 * offers the action that fixes it.
 *
 * Every panel carries a distinct glyph as well as a distinct tone, so the
 * category is still readable without colour vision.
 */

type Tone = "neutral" | "warn" | "danger";

const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-border",
  warn: "border-warn/45",
  danger: "border-danger/45",
};

const TONE_MARK: Record<Tone, string> = {
  neutral: "border-border bg-surface-2 text-ink-faint",
  warn: "border-warn/45 bg-warn/10 text-warn",
  danger: "border-danger/45 bg-danger/10 text-danger",
};

type Glyph = "empty" | "locked" | "offline" | "revoked" | "network";

/** Shape carries the category; colour only reinforces it. */
function StateGlyph({ glyph }: { glyph: Glyph }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph === "empty" ? (
        <>
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" strokeDasharray="3 2.5" />
          <path d="M9 12h6" />
        </>
      ) : null}
      {glyph === "locked" ? (
        <>
          <rect x="4.5" y="10.5" width="15" height="9" rx="2" />
          <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
        </>
      ) : null}
      {glyph === "offline" ? (
        <>
          <path d="M3 6.5 21 19.5" />
          <path d="M6.5 12.5a8 8 0 0 1 11 0" />
          <path d="M9.5 15.8a4 4 0 0 1 5 0" />
        </>
      ) : null}
      {glyph === "revoked" ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M7.5 7.5l9 9" />
        </>
      ) : null}
      {glyph === "network" ? (
        <>
          <path d="M12 3.5v17" />
          <path d="M5 8.5l7-5 7 5v7l-7 5-7-5z" />
        </>
      ) : null}
    </svg>
  );
}

interface StatePanelProps {
  title: string;
  glyph: Glyph;
  tone?: Tone;
  /** `alert` for failures the user did not ask for, `status` for everything else. */
  live?: "alert" | "status";
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function StatePanel({
  title,
  glyph,
  tone = "neutral",
  live = "status",
  children,
  action,
  className,
}: StatePanelProps) {
  return (
    <GlassCard
      padding="lg"
      role={live}
      aria-live={live === "alert" ? "assertive" : "polite"}
      className={cn("text-center", TONE_BORDER[tone], className)}
    >
      <span
        className={cn(
          "mx-auto mb-4 inline-flex size-11 items-center justify-center rounded-full border",
          TONE_MARK[tone],
        )}
      >
        <StateGlyph glyph={glyph} />
      </span>
      <h2 className="display-sm mb-2 text-lg font-semibold text-ink">{title}</h2>
      {children ? (
        <div className="mx-auto max-w-md text-sm leading-relaxed text-ink-muted">
          {children}
        </div>
      ) : null}
      {action ? <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </GlassCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Skeletons shaped like the thing that is coming, so the layout does not jump.
 * One screen-reader announcement covers the whole group rather than one per box.
 */
export function LoadingPanel({
  label,
  shape = "rows",
  rows = 4,
}: {
  label: string;
  shape?: "rows" | "cards";
  rows?: number;
}) {
  return (
    <div>
      <SkeletonLabel>{label}</SkeletonLabel>
      {shape === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: rows }, (_, i) => (
            <GlassCard key={i} padding="md">
              <Skeleton className="mb-4 h-32 w-full rounded-md" shape="block" />
              <Skeleton className="mb-2 w-2/3" />
              <Skeleton className="w-1/3" />
            </GlassCard>
          ))}
        </div>
      ) : (
        <GlassCard padding="md">
          <Skeleton className="mb-5 h-4 w-40" />
          <div className="flex flex-col gap-4">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton shape="circle" className="size-8 shrink-0" />
                <Skeleton className="w-full" />
                <Skeleton className="hidden w-24 shrink-0 sm:block" />
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Named causes                                                                */
/* -------------------------------------------------------------------------- */

/** Nothing exists yet. Says who can create the first one. */
export function EmptyPanel({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <StatePanel title={title} glyph="empty" action={action}>
      {children}
    </StatePanel>
  );
}

/**
 * A 403. The role is named, and so is the permission that would grant access,
 * because "contact your administrator" without naming what to ask for wastes
 * everybody's time.
 */
export function DeniedPanel({
  permission,
  role,
  children,
}: {
  permission: string;
  role?: string;
  children?: React.ReactNode;
}) {
  return (
    <StatePanel title="You do not have access to this" glyph="locked" tone="warn">
      <p>
        {children ?? (
          <>
            Reading this needs the{" "}
            <code className="font-mono text-ink">{permission}</code> permission in
            this organisation.
          </>
        )}
      </p>
      {role ? (
        <p className="mt-3">
          Your role here is <span className="font-semibold text-ink">{role}</span>.
          An admin can grant the permission on the{" "}
          <Link href="/dashboard/roles" className="text-accent underline">
            roles screen
          </Link>{" "}
          without redeploying anything.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-ink-faint">
        The check runs against the contract on every request, so a change takes
        effect on your next reload rather than at your next sign-in.
      </p>
    </StatePanel>
  );
}

/** The identity behind the session has been revoked on-chain. */
export function RevokedPanel() {
  const { signOut } = useWallet();
  return (
    <StatePanel
      title="This identity has been revoked"
      glyph="revoked"
      tone="danger"
      live="alert"
      action={
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      }
    >
      <p>
        Every role, permission and application grant attached to this wallet was
        withdrawn in the same block the revocation landed. Nothing in the console
        will load until a registrar reactivates it.
      </p>
    </StatePanel>
  );
}

/** The wallet is on a different chain from the one the console reads. */
export function WrongNetworkPanel() {
  const { chainId, fixChain } = useWallet();
  return (
    <StatePanel
      title="Your wallet is on the wrong network"
      glyph="network"
      tone="warn"
      action={
        <Button variant="primary" onClick={() => void fixChain()}>
          Switch to {CHAIN.name}
        </Button>
      }
    >
      <p>
        This console reads {CHAIN.name} ({CHAIN.id}), and your wallet is on chain{" "}
        {chainId ?? "unknown"}. Anything shown would describe a different set of
        contracts, so it is not shown at all.
      </p>
    </StatePanel>
  );
}

/** The server could not reach the chain or the database. */
export function RpcFailurePanel({
  onRetry,
  detail,
}: {
  onRetry?: () => void;
  detail?: string;
}) {
  return (
    <StatePanel
      title="Could not reach the chain"
      glyph="offline"
      tone="danger"
      live="alert"
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      <p>
        The server answered, but it could not read {CHAIN.name} or the record
        store. Nothing is cached to fall back on, which is deliberate: a stale
        role is worse than a visible failure.
      </p>
      <p className="mt-3 text-xs text-ink-faint">
        Running locally? Start the node with{" "}
        <code className="font-mono">npm run dev:chain</code>, then seed it with{" "}
        <code className="font-mono">npm run seed:all</code>.
      </p>
      {detail ? (
        <p className="mt-3 font-mono text-[0.6875rem] break-words text-ink-faint">
          {detail}
        </p>
      ) : null}
    </StatePanel>
  );
}

/** Signed in, but a member of nothing. */
export function NoOrganisationPanel() {
  return (
    <StatePanel title="No organisation yet" glyph="empty">
      <p>
        This wallet holds a valid identity but is not a member of any
        organisation, so there is no roster, vault or history to show. An admin
        adds a member by wallet address; there is no invite email.
      </p>
    </StatePanel>
  );
}

/**
 * A technical detail worth printing under the explanation, or nothing.
 *
 * The API answers unexpected failures with "Something went wrong" on purpose, so
 * repeating it below a panel that has just explained the likely cause in full
 * adds no information and makes the explanation look like a guess. Only a real
 * client-side failure — a fetch that never reached the server — says anything the
 * panel does not already.
 */
export function technicalDetail(error: unknown): string | undefined {
  if (error instanceof ApiRequestError) return undefined;
  if (error instanceof Error && error.message) return error.message;
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Failure router                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Turns whatever a request threw into the right panel.
 *
 * The API deliberately returns a generic message for unexpected 5xx errors,
 * which is correct for security and useless in an interface. In this app a 5xx
 * from a read endpoint almost always means the RPC or Supabase is down, so that
 * is what the user is told.
 */
export function ApiErrorPanel({
  error,
  permission,
  role,
  onRetry,
}: {
  error: unknown;
  /** Named in the denied state when the failure is a 403. */
  permission: string;
  role?: string;
  onRetry?: () => void;
}) {
  if (error instanceof ApiRequestError) {
    if (error.status === 403) {
      // The authz layer uses the same 403 for a revoked identity as for a
      // missing permission, so the message decides which panel is honest.
      if (/revoked/i.test(error.message)) return <RevokedPanel />;
      if (/not a member/i.test(error.message)) return <NoOrganisationPanel />;
      return (
        <DeniedPanel permission={permission} role={role}>
          {error.message}
        </DeniedPanel>
      );
    }

    if (error.status === 401) {
      return (
        <StatePanel title="Your session ended" glyph="locked" tone="warn">
          <p>
            The session cookie is no longer valid. Sign in again from the button
            in the top bar; it costs no gas.
          </p>
        </StatePanel>
      );
    }

    if (error.status >= 500) {
      return <RpcFailurePanel onRetry={onRetry} />;
    }

    return (
      <StatePanel
        title="That request was refused"
        glyph="empty"
        tone="warn"
        live="alert"
        action={
          onRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          ) : undefined
        }
      >
        <p>{error.message}</p>
      </StatePanel>
    );
  }

  // A thrown TypeError from fetch means the request never reached the server.
  return <RpcFailurePanel onRetry={onRetry} detail={technicalDetail(error)} />;
}
