"use client";

import * as React from "react";
import Link from "next/link";

import { listAssets, type AssetSummary } from "@/lib/api";
import { CHAIN, shortAddress } from "@/lib/wallet";
import { useResource } from "@/lib/use-resource";
import {
  Badge,
  Button,
  GlassCard,
  Identicon,
  RoleChip,
  VerificationBadge,
  type Role,
} from "@/components/ui";
import { useWallet } from "@/components/wallet/wallet-provider";
import { LoadingPanel } from "@/components/console/states";
import { useConsoleScreen } from "@/components/console/use-console-screen";
import { MonoValue } from "@/components/console/copy-field";

/**
 * Overview, in two shapes.
 *
 * One route rather than two, because a separate `/user` URL would be a link that
 * goes stale the moment somebody's role changes — and roles here change by design.
 * The screen asks what the caller may do and shows that; nothing is hidden that
 * they could otherwise reach, and nothing administrative is shown to somebody who
 * cannot use it.
 *
 * The plain-user view is deliberately short on vocabulary. It says "equipment
 * assigned to you", not "ERC-721 tokens held by your wallet". Both are true; only
 * one is useful to somebody who was handed a laptop.
 */
export function Overview() {
  const { session, gate, role } = useConsoleScreen();

  if (gate) return <div>{gate}</div>;
  if (!session) return null;

  const isAdminish = role === "ADMIN" || role === "MANAGER" || role === "AUDITOR";
  return isAdminish ? <AdminOverview /> : <UserOverview />;
}

/* -------------------------------------------------------------------------- */
/* Plain user                                                                  */
/* -------------------------------------------------------------------------- */

function UserOverview() {
  const { session, orgId, role } = useConsoleScreen();

  const load = React.useCallback(
    () => (orgId === null ? Promise.reject(new Error("No organisation")) : listAssets(orgId)),
    [orgId],
  );
  const assets = useResource(orgId !== null ? load : null);

  if (!session) return null;

  const mine = (assets.data?.assets ?? []).filter(
    (asset) => asset.assignedTo.toLowerCase() === session.wallet.toLowerCase(),
  );

  return (
    <div>
      <header className="mb-8">
        <p className="label-xs mb-2 text-accent">Your account</p>
        <h1 className="display-sm text-2xl font-semibold text-ink sm:text-3xl">
          {session.profile?.displayName
            ? `Hello, ${session.profile.displayName}`
            : shortAddress(session.wallet)}
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <RoleChip role={role as Role} />
          {session.identity.active ? (
            <VerificationBadge state="verified" />
          ) : (
            <VerificationBadge state="revoked" />
          )}
        </p>
      </header>

      <GlassCard padding="md" className="mb-4">
        <h2 className="label-xs mb-3 text-ink-faint">Assigned to you</h2>

        {assets.status === "loading" && !assets.data ? (
          <LoadingPanel label="Loading the equipment assigned to you" rows={2} />
        ) : mine.length === 0 ? (
          <p className="text-sm leading-relaxed text-ink-muted">
            Nothing is assigned to you at the moment. When your organisation issues
            you equipment or a licence, it appears here with a record you can show
            to anybody who asks.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {mine.map((asset) => (
              <li key={asset.tokenId}>
                <SimpleAssetRow asset={asset} />
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      <div className="grid gap-4 sm:grid-cols-2">
        <GlassCard padding="md">
          <h2 className="label-xs mb-3 text-ink-faint">Your record</h2>
          <p className="mb-4 text-sm leading-relaxed text-ink-muted">
            Your name, email and department are stored encrypted. What is published
            is a fingerprint of them — enough to prove nobody has altered your
            record, not enough to read it.
          </p>
          <MonoValue value={session.wallet} label="your wallet address" head={12} tail={8} />
          <p className="mt-4">
            <Link
              href="/dashboard/identity"
              className="font-mono text-[0.6875rem] font-semibold tracking-[0.12em] text-accent uppercase hover:underline"
            >
              See your details
            </Link>
          </p>
        </GlassCard>

        <GlassCard padding="md">
          <h2 className="label-xs mb-3 text-ink-faint">What you can do here</h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Your role is{" "}
            <span className="font-semibold text-ink">{role.toLowerCase()}</span>, so
            this account can see what it holds and what its own record says. Adding
            people, issuing equipment and reading the organisation&apos;s history are
            administrative, and are not part of it.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            That is enforced by the contract on every request, not by hiding
            buttons.
          </p>
        </GlassCard>
      </div>
    </div>
  );
}

/** One asset, described in plain words. No token ids in the primary line. */
function SimpleAssetRow({ asset }: { asset: AssetSummary }) {
  return (
    <Link
      href={`/dashboard/assets/${asset.tokenId}`}
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-2 p-3 transition-colors duration-200 hover:bg-brand-soft"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{asset.name}</span>
        <span className="text-xs text-ink-muted">
          {asset.assetType}
          {asset.department ? ` · ${asset.department}` : ""}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {asset.active ? (
          <Badge tone="success">Yours</Badge>
        ) : (
          <Badge tone="warn">Withdrawn</Badge>
        )}
        {asset.recordIntact === false ? <VerificationBadge state="tampered" /> : null}
      </span>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Admin, manager, auditor                                                     */
/* -------------------------------------------------------------------------- */

function AdminOverview() {
  const { session, role } = useConsoleScreen();
  const { refresh } = useWallet();

  if (!session) return null;

  const { identity, memberships, permissions, assets, activeOrgId } = session;
  const canMint = permissions?.MINT_ASSETS ?? false;
  const canManageMembers = permissions?.MANAGE_MEMBERS ?? false;

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="label-xs mb-2 text-accent">Overview</p>
          <h1 className="display-sm text-2xl font-semibold text-ink sm:text-3xl">
            {session.profile?.displayName
              ? `Welcome back, ${session.profile.displayName}`
              : shortAddress(session.wallet)}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageMembers ? (
            <Link href="/dashboard/members">
              <Button variant="secondary">Members</Button>
            </Link>
          ) : null}
          {canMint ? (
            <Link href="/dashboard/assets/new">
              <Button variant="primary">Mint a certificate</Button>
            </Link>
          ) : null}
        </div>
      </header>

      <dl className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Organisations" value={String(memberships.length)} />
        <Stat label="Assets held" value={String(assets.length)} />
        <Stat
          label="Permissions"
          value={
            permissions
              ? String(Object.values(permissions).filter(Boolean).length)
              : "0"
          }
        />
        <Stat label="Network" value={CHAIN.name} mono />
      </dl>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <GlassCard padding="md">
          <h2 className="label-xs mb-4 text-ink-faint">Identity</h2>
          <dl className="flex flex-col">
            <Row label="DID" value={identity.did} mono />
            <Row label="Wallet" value={session.wallet} mono />
            <Row
              label="Status"
              node={
                identity.registered ? (
                  identity.active ? (
                    <VerificationBadge state="verified" />
                  ) : (
                    <VerificationBadge state="revoked" />
                  )
                ) : (
                  <VerificationBadge state="unverified" />
                )
              }
            />
            <Row
              label="Record integrity"
              node={
                identity.recordIntact === null ? (
                  <Badge tone="neutral">No anchor to compare</Badge>
                ) : identity.recordIntact ? (
                  <VerificationBadge state="verified" />
                ) : (
                  <VerificationBadge state="tampered" withHint />
                )
              }
            />
          </dl>
          <Link
            href="/dashboard/identity"
            className="mt-5 inline-block font-mono text-[0.6875rem] font-semibold tracking-[0.12em] text-accent uppercase hover:underline"
          >
            View full identity
          </Link>
        </GlassCard>

        <GlassCard padding="md">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="label-xs text-ink-faint">Memberships</h2>
            <button
              type="button"
              onClick={() => void refresh()}
              className="font-mono text-[0.625rem] font-semibold tracking-[0.1em] text-accent uppercase hover:underline"
            >
              Re-read
            </button>
          </div>

          {memberships.length === 0 ? (
            <p className="text-sm leading-relaxed text-ink-muted">
              This wallet is not a member of any organisation yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {memberships.map((m) => (
                <li
                  key={m.orgId}
                  className="flex items-center justify-between gap-3 border-b border-border-soft pb-3 last:border-0 last:pb-0"
                >
                  <span className="flex items-center gap-2">
                    <Identicon value={`org-${m.orgId}`} size={22} />
                    <span className="font-mono text-xs text-ink">
                      Organisation #{m.orgId}
                    </span>
                  </span>
                  <RoleChip
                    role={m.role as Role}
                    expiresAt={
                      m.expiresAt
                        ? new Date(m.expiresAt * 1000).toLocaleDateString()
                        : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          )}

          {permissions && Object.values(permissions).some(Boolean) ? (
            <>
              <h3 className="label-xs mt-6 mb-3 text-ink-faint">
                Permissions in org #{activeOrgId}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(permissions)
                  .filter(([, granted]) => granted)
                  .map(([p]) => (
                    <Badge key={p} tone="brand" mono>
                      {p}
                    </Badge>
                  ))}
              </div>
            </>
          ) : null}

          <p className="mt-5 border-t border-border-soft pt-3 text-xs text-ink-faint">
            Effective role: <RoleChip role={role as Role} className="ms-1" />
          </p>
        </GlassCard>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Stat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <GlassCard padding="md">
      <dt className="label-xs mb-2 text-ink-faint">{label}</dt>
      <dd
        className={
          mono
            ? "font-mono text-sm text-ink"
            : "font-mono text-3xl font-bold tracking-tight text-brand"
        }
      >
        {value}
      </dd>
    </GlassCard>
  );
}

function Row({
  label,
  value,
  node,
  mono = false,
}: {
  label: string;
  value?: string;
  node?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-soft py-2.5 last:border-0">
      <dt className="label-xs shrink-0 text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-end">
        {node ?? (
          <span
            className={
              mono ? "font-mono text-xs break-all text-ink" : "text-sm text-ink"
            }
          >
            {value}
          </span>
        )}
      </dd>
    </div>
  );
}
