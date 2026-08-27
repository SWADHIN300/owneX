"use client";

import { CHAIN } from "@/lib/wallet";
import { useWallet } from "@/components/wallet/wallet-provider";
import {
  Badge,
  GlassCard,
  Identicon,
  RoleChip,
  VerificationBadge,
  type Role,
} from "@/components/ui";

/**
 * My identity.
 *
 * Laid out as the split it actually is: what the chain holds on one side, what
 * stays in the encrypted store on the other, and the integrity check between
 * them. This is the screen that makes the privacy claim concrete for a user,
 * so it names the anchor and says plainly that the chain never held their
 * details.
 */
export default function IdentityPage() {
  const { session } = useWallet();
  if (!session) return null;

  const { identity, profile, memberships, activeOrgId, assets } = session;
  const activeRole = (memberships.find((m) => m.orgId === activeOrgId)?.role ??
    "NONE") as Role;

  return (
    <div>
      <header className="mb-8 flex items-start gap-4">
        <Identicon value={session.wallet} size={52} />
        <div className="min-w-0">
          <p className="label-xs mb-2 text-accent">My identity</p>
          <h1 className="display-sm text-2xl font-semibold text-ink sm:text-3xl">
            {profile?.displayName ?? "Unnamed identity"}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <RoleChip role={activeRole} />
            {identity.registered ? (
              identity.active ? (
                <VerificationBadge state="verified" />
              ) : (
                <VerificationBadge state="revoked" withHint />
              )
            ) : (
              <VerificationBadge state="unverified" withHint />
            )}
          </p>
        </div>
      </header>

      {!identity.registered ? (
        <GlassCard padding="md" className="mb-4 border-warn/40">
          <p className="text-sm leading-relaxed text-ink">
            This wallet has signed in, but it has no identity registered on{" "}
            {CHAIN.name} yet. Registration is what anchors your record, and until
            it happens there is nothing for a verifier to check against.
          </p>
        </GlassCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard padding="md">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="label-xs text-ink-faint">On the chain</h2>
            <Badge tone="brand">Public and permanent</Badge>
          </div>
          <dl className="flex flex-col">
            <Row label="DID" value={identity.did} mono />
            <Row label="Wallet" value={session.wallet} mono />
            <Row
              label="Identity hash"
              value={identity.identityHash ?? "Not anchored"}
              mono
            />
            <Row
              label="Registered"
              value={
                identity.registeredAt
                  ? new Date(identity.registeredAt * 1000).toLocaleString()
                  : "Not registered"
              }
            />
            <Row label="Assets held" value={String(assets.length)} />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            Note what is absent: no name, no email, no department. The chain holds
            a fingerprint of your record, never the record.
          </p>
        </GlassCard>

        <GlassCard padding="md">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="label-xs text-ink-faint">Off the chain</h2>
            <Badge tone="neutral">Encrypted, AES-256-GCM</Badge>
          </div>
          {profile ? (
            <dl className="flex flex-col">
              <Row label="Display name" value={profile.displayName ?? "Not set"} />
              <Row label="Job title" value={profile.jobTitle ?? "Not set"} />
              <Row label="Department" value={profile.department ?? "Not set"} />
              <Row
                label="Email"
                value={profile.email ?? "Not set"}
                hint="Only you see this in full. Everywhere else it is masked."
              />
            </dl>
          ) : (
            <p className="text-sm leading-relaxed text-ink-muted">
              No off-chain profile for this wallet yet. Your identity works without
              one; a profile only adds display details.
            </p>
          )}
        </GlassCard>
      </div>

      <GlassCard padding="md" className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="label-xs mb-2 text-ink-faint">Integrity check</h2>
            <p className="max-w-xl text-sm leading-relaxed text-ink-muted">
              The encrypted record is re-hashed and compared against the anchor
              above. A match proves it has not been altered since it was
              registered; a mismatch proves it has.
            </p>
          </div>
          {identity.recordIntact === null ? (
            <Badge tone="neutral">Nothing to compare yet</Badge>
          ) : identity.recordIntact ? (
            <VerificationBadge state="verified" withHint />
          ) : (
            <VerificationBadge state="tampered" withHint />
          )}
        </div>
      </GlassCard>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="border-b border-border-soft py-2.5 last:border-0">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="label-xs shrink-0 text-ink-faint">{label}</dt>
        <dd
          className={
            mono
              ? "min-w-0 font-mono text-xs break-all text-ink"
              : "min-w-0 text-end text-sm text-ink"
          }
        >
          {value}
        </dd>
      </div>
      {hint ? <p className="mt-1 text-[0.625rem] text-ink-faint">{hint}</p> : null}
    </div>
  );
}
