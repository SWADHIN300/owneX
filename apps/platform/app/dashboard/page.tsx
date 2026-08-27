"use client";

import Link from "next/link";

import { CHAIN, shortAddress } from "@/lib/wallet";
import { useWallet } from "@/components/wallet/wallet-provider";
import {
  Badge,
  GlassCard,
  RoleChip,
  VerificationBadge,
  type Role,
} from "@/components/ui";

/**
 * Overview.
 *
 * Every figure here comes from `/api/identity/me`, which re-reads the chain on
 * each request. Nothing is cached client-side, so a role revoked in another tab
 * shows up on the next load rather than persisting until sign-out.
 */
export default function DashboardPage() {
  const { session } = useWallet();
  if (!session) return null;

  const { identity, memberships, permissions, assets, activeOrgId } = session;
  const activeRole = (memberships.find((m) => m.orgId === activeOrgId)?.role ??
    "NONE") as Role;

  return (
    <div>
      <header className="mb-8">
        <p className="label-xs mb-2 text-accent">Overview</p>
        <h1 className="display-sm text-2xl font-semibold text-ink sm:text-3xl">
          {session.profile?.displayName
            ? `Welcome back, ${session.profile.displayName}`
            : shortAddress(session.wallet)}
        </h1>
      </header>

      <dl className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Organisations" value={String(memberships.length)} />
        <Stat label="Assets held" value={String(assets.length)} />
        <Stat
          label="Permissions"
          value={permissions ? String(permissions.length) : "0"}
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
            className="mt-5 inline-block font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-accent hover:underline"
          >
            View full identity
          </Link>
        </GlassCard>

        <GlassCard padding="md">
          <h2 className="label-xs mb-4 text-ink-faint">Memberships</h2>
          {memberships.length === 0 ? (
            <p className="text-sm leading-relaxed text-ink-muted">
              This wallet is not a member of any organisation yet. An admin has to
              add it before roles or assets appear.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {memberships.map((m) => (
                <li
                  key={m.orgId}
                  className="flex items-center justify-between gap-3 border-b border-border-soft pb-3 last:border-0 last:pb-0"
                >
                  <span className="font-mono text-xs text-ink">
                    Organisation #{m.orgId}
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

          {permissions && permissions.length > 0 ? (
            <>
              <h3 className="label-xs mt-6 mb-3 text-ink-faint">
                Permissions in org #{activeOrgId}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {permissions.map((p) => (
                  <Badge key={p} tone="brand" mono>
                    {p}
                  </Badge>
                ))}
              </div>
            </>
          ) : null}

          <p className="mt-5 border-t border-border-soft pt-3 text-xs text-ink-faint">
            Effective role: <RoleChip role={activeRole} className="ms-1" />
          </p>
        </GlassCard>
      </div>
    </div>
  );
}

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
