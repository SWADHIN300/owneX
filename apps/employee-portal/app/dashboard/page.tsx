import { redirect } from "next/navigation";

import { session } from "@/lib/session";
import { verifyAccess } from "@/lib/ownex";

/**
 * The portal's protected page.
 *
 * The role is re-read from owneX on every render rather than taken from the
 * cookie, so a revocation or an expiry appears on the very next request. There is
 * no personal data on this page because owneX does not send any: the portal knows
 * a wallet address, an organization, a role and a set of permission flags.
 */

export const dynamic = "force-dynamic";

function shorten(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default async function Dashboard() {
  const store = await session();
  if (!store.wallet) redirect("/");

  const verified = await verifyAccess(store.wallet);
  if (!verified.allowed) {
    redirect(`/denied?reason=${encodeURIComponent(verified.reason ?? "ACCESS_DENIED")}`);
  }

  const checkedAt = verified.verifiedAt
    ? new Date(verified.verifiedAt).toLocaleString()
    : "just now";

  const granted = Object.entries(verified.permissions)
    .filter(([, allowed]) => allowed)
    .map(([key]) => key.replaceAll("_", " ").toLowerCase());

  return (
    <main className="wrap">
      <div className="eyebrow">Employee workspace</div>
      <h1>Welcome.</h1>
      <p className="muted">
        You signed in with owneX. This portal holds no keys, uses no wallet library and talks to no
        blockchain — your role was verified on-chain by owneX and re-checked just now.
      </p>

      <div className="status">
        <div className="pill">{verified.role}</div>
        <h3>Live access check</h3>
        <p className="muted">
          Verified at {checkedAt} · organization #{store.orgId} · source: owneX role verification
        </p>
        <small>
          A revocation, a suspension or an expired membership appears on your next request. Nothing
          about your access is cached in this portal&apos;s session.
        </small>
      </div>

      <div className="grid">
        <div className="card">
          <h3>Signed in as</h3>
          <p>{shorten(store.wallet)}</p>
          <p className="muted">Wallet verified by owneX</p>
        </div>
        <div className="card">
          <h3>Role</h3>
          <p>{verified.role}</p>
          <p className="muted">Read live from the OrgAccessManager contract</p>
        </div>
        <div className="card">
          <h3>Permissions</h3>
          <p>{granted.length > 0 ? granted.join(" · ") : "Read-only access"}</p>
        </div>
        <div className="card">
          <h3>Membership</h3>
          <p>{verified.membership?.expired ? "Expired" : "Active"}</p>
          <p className="muted">
            {verified.membership?.expiresAt
              ? `Expires ${new Date(verified.membership.expiresAt * 1000).toLocaleDateString()}`
              : "No expiry set"}
          </p>
        </div>
      </div>
    </main>
  );
}
