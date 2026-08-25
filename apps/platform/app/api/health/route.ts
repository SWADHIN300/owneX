import { NextResponse } from "next/server";

/**
 * GET /api/health
 *
 * Deliberately tolerant of missing configuration: it reports what is wired up
 * rather than throwing. Useful while setting the project up, and as a quick
 * check that the RPC endpoint and database are actually reachable.
 *
 * Reports presence of secrets, never their values.
 */
export async function GET() {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RPC_URL",
    "CHAIN_ID",
    "IDENTITY_REGISTRY_ADDRESS",
    "ORG_ACCESS_MANAGER_ADDRESS",
    "ASSET_NFT_ADDRESS",
    "SESSION_PASSWORD",
    "PII_ENCRYPTION_KEY",
    "APP_DOMAIN",
    "APP_ORIGIN",
  ] as const;

  const missing = required.filter((key) => !process.env[key]);
  const configured = missing.length === 0;

  const checks: Record<string, unknown> = {
    configured,
    missing,
  };

  // ── Chain reachability ──────────────────────────────────────────
  if (process.env.RPC_URL) {
    try {
      const { JsonRpcProvider } = await import("ethers");
      const p = new JsonRpcProvider(process.env.RPC_URL);
      const [blockNumber, network] = await Promise.all([p.getBlockNumber(), p.getNetwork()]);
      checks.chain = { reachable: true, blockNumber, chainId: Number(network.chainId) };
    } catch (error) {
      checks.chain = { reachable: false, error: error instanceof Error ? error.message : "unknown" };
    }
  } else {
    checks.chain = { reachable: false, error: "RPC_URL not set" };
  }

  // ── Contract reachability ───────────────────────────────────────
  if (configured) {
    try {
      const { identityRegistry } = await import("@/lib/chain");
      const count = await identityRegistry().organizationCount();
      checks.contracts = { reachable: true, organizationCount: Number(count) };
    } catch (error) {
      checks.contracts = { reachable: false, error: error instanceof Error ? error.message : "unknown" };
    }
  }

  // ── Database reachability ───────────────────────────────────────
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { db } = await import("@/lib/supabase");
      const { error } = await db().from("organizations").select("org_id").limit(1);
      checks.database = error ? { reachable: false, error: error.message } : { reachable: true };
    } catch (error) {
      checks.database = { reachable: false, error: error instanceof Error ? error.message : "unknown" };
    }
  } else {
    checks.database = { reachable: false, error: "Supabase env not set" };
  }

  const healthy =
    configured &&
    (checks.chain as { reachable: boolean }).reachable &&
    (checks.database as { reachable: boolean }).reachable;

  return NextResponse.json(
    { service: "ownex-platform", healthy, checkedAt: new Date().toISOString(), ...checks },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
