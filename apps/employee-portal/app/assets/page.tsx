import { redirect } from "next/navigation";

import { session } from "@/lib/session";
import { verifyAccess } from "@/lib/ownex";
import { clientAuthHeader, ownexConfig } from "@/lib/config";

/**
 * Assets assigned to the signed-in wallet.
 *
 * Access is revalidated before anything is fetched: a page that shows
 * organization data must not render for a wallet whose role has just been
 * revoked, and checking the session cookie alone would do exactly that.
 */

export const dynamic = "force-dynamic";

type PortalAsset = { tokenId: number; name?: string; assetType?: string; active: boolean };

export default async function Assets() {
  const store = await session();
  if (!store.wallet) redirect("/");

  const verified = await verifyAccess(store.wallet);
  if (!verified.allowed) {
    redirect(`/denied?reason=${encodeURIComponent(verified.reason ?? "ACCESS_DENIED")}`);
  }

  let assets: PortalAsset[] = [];
  try {
    const config = ownexConfig();
    const url = new URL("/api/portal/assets", `${config.origin}/`);
    url.searchParams.set("wallet", store.wallet);
    url.searchParams.set("orgId", String(config.orgId));

    const response = await fetch(url, {
      headers: { authorization: clientAuthHeader(config) },
      cache: "no-store",
    });
    if (response.ok) {
      const data = (await response.json()) as { assets?: PortalAsset[] };
      assets = data.assets ?? [];
    }
  } catch {
    // An unreachable owneX shows an empty vault rather than stale data.
    assets = [];
  }

  return (
    <main className="wrap">
      <div className="eyebrow">Assigned to you</div>
      <h1>Assets</h1>
      <p className="muted">Certificates and equipment assigned by your organization.</p>
      <div className="grid">
        {assets.map((asset) => (
          <div className="card asset" key={asset.tokenId}>
            <div>
              <h3>{asset.name ?? `Asset #${asset.tokenId}`}</h3>
              <p className="muted">{asset.assetType ?? "Asset"}</p>
            </div>
            <span className="pill">{asset.active ? "Active" : "Revoked"}</span>
          </div>
        ))}
      </div>
      {assets.length === 0 ? (
        <div className="card">
          <p>No assets are assigned to you yet.</p>
        </div>
      ) : null}
    </main>
  );
}
