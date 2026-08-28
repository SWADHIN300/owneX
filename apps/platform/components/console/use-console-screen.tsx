"use client";

import * as React from "react";

import type { Me } from "@/lib/api";
import { useWallet } from "@/components/wallet/wallet-provider";
import {
  NoOrganisationPanel,
  RevokedPanel,
  WrongNetworkPanel,
} from "@/components/console/states";

/**
 * The gate every org-scoped screen runs before it fetches anything.
 *
 * Three conditions make the data on a screen meaningless rather than merely
 * empty, and each has a different fix, so each gets its own panel:
 *
 *   wrong network     the wallet is pointed at different contracts entirely
 *   revoked identity  the session is valid but every role behind it is gone
 *   no organisation   there is nothing to scope a roster or vault to
 *
 * Returning JSX from a hook is unusual, but the alternative — a render-prop
 * wrapper around four screens — buries the actual page one callback deeper for
 * no gain. `gate` is either the panel to render instead of the screen, or null.
 */
export interface ConsoleScreen {
  session: Me | null;
  orgId: number | null;
  role: string;
  /** Render this instead of the screen when it is not null. */
  gate: React.ReactNode | null;
}

export function useConsoleScreen(): ConsoleScreen {
  const { session, wrongChain } = useWallet();

  const orgId = session?.activeOrgId ?? null;
  const role =
    session?.memberships.find((m) => m.orgId === session.activeOrgId)?.role ?? "NONE";

  // The shell has already handled "loading" and "signed out"; a null session
  // here means the shell is about to replace this subtree anyway.
  if (!session) return { session: null, orgId: null, role, gate: null };

  if (wrongChain) {
    return { session, orgId, role, gate: <WrongNetworkPanel /> };
  }

  if (session.identity.registered && !session.identity.active) {
    return { session, orgId, role, gate: <RevokedPanel /> };
  }

  if (orgId === null) {
    return { session, orgId, role, gate: <NoOrganisationPanel /> };
  }

  return { session, orgId, role, gate: null };
}

/* -------------------------------------------------------------------------- */

/**
 * Screen heading. Consistent across the console so the eye lands in the same
 * place on every route: kicker, title, one sentence of what the screen is for,
 * and any actions pushed to the end.
 */
export function ScreenHeader({
  kicker,
  title,
  children,
  actions,
}: {
  kicker: string;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="label-xs mb-2 text-accent">{kicker}</p>
        <h1 className="display-sm text-2xl font-semibold text-ink sm:text-3xl">
          {title}
        </h1>
        {children ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {children}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
