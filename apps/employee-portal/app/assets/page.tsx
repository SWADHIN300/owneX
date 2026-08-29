import { redirect } from "next/navigation";
import { session } from "@/lib/session";
import { getPlatformOrigin } from "@/lib/config";

export default async function Assets() {
  const s = await session();
  if (!s.wallet) redirect("/");

  let assets: Array<{ tokenId: number; name: string; assetType: string; active: boolean }> = [];
  try {
    const origin = getPlatformOrigin();
    const u = new URL("/api/portal/assets", origin);
    u.searchParams.set("wallet", s.wallet);
    u.searchParams.set("orgId", process.env.PORTAL_ORG_ID ?? "1");
    const r = await fetch(u, { cache: "no-store" });
    if (r.ok) {
      const data = await r.json();
      assets = data.assets ?? [];
    }
  } catch {
    assets = [];
  }

  return (
    <main className="wrap">
      <div className="eyebrow">Assigned to you</div>
      <h1>Assets</h1>
      <p className="muted">Certificates and equipment assigned by your organization.</p>
      <div className="grid">
        {assets.map((a) => (
          <div className="card asset" key={a.tokenId}>
            <div>
              <h3>{a.name}</h3>
              <p className="muted">{a.assetType}</p>
            </div>
            <span className="pill">{a.active ? "Active" : "Revoked"}</span>
          </div>
        ))}
      </div>
      {!assets.length && (
        <div className="card">
          <p>No assets are assigned to you yet.</p>
        </div>
      )}
    </main>
  );
}
