/**
 * End-to-end API verification.
 *
 *   node scripts/verify-api.mjs
 *
 * Performs real SIWE logins with real signatures and exercises every route,
 * asserting both what should succeed and what should be refused. Run it after
 * any backend change.
 *
 * Prerequisites:
 *   npx hardhat node          (contracts workspace)
 *   npm run deploy:local
 *   npm run seed:local
 *   node scripts/seed-offchain.mjs
 *   npm run dev               (this app)
 *
 * The private keys below are Hardhat's publicly-known test accounts. They hold
 * nothing but local test ETH and must never be used anywhere real.
 */
import { Wallet } from "ethers";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ORG_ID = 1;

const ACCOUNTS = {
  admin: { pk: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", label: "Priya Sharma (root ADMIN)" },
  manager: { pk: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", label: "Rahul Verma (MANAGER)" },
  employee: { pk: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", label: "Arjun Mehta (USER)" },
};

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}${detail ? "  " + detail : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? "  " + detail : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
  console.log("─".repeat(Math.max(title.length, 58)));
}

/** Minimal cookie jar so a session survives across requests. */
function makeClient() {
  let cookie = null;
  return async (path, init = {}) => {
    const headers = { "Content-Type": "application/json", ...(init.headers ?? {}) };
    if (cookie) headers.Cookie = cookie;

    const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];

    let body = null;
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  };
}

/** Full SIWE handshake: request a challenge, sign it, exchange it for a session. */
async function login(client, pk) {
  const wallet = new Wallet(pk);

  const challenge = await client("/api/auth/nonce", {
    method: "POST",
    body: JSON.stringify({ wallet: wallet.address }),
  });
  if (challenge.status !== 200) {
    throw new Error(`nonce failed: ${challenge.status} ${JSON.stringify(challenge.body)}`);
  }

  const signature = await wallet.signMessage(challenge.body.message);

  const verified = await client("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ message: challenge.body.message, signature }),
  });

  return { wallet, challenge: challenge.body, verified };
}

async function main() {
  console.log("═".repeat(58));
  console.log(`OwneX API verification → ${BASE}`);
  console.log("═".repeat(58));

  // ── health ────────────────────────────────────────────────────────
  section("health");
  {
    const anon = makeClient();
    const { body } = await anon("/api/health");
    check("configured", body.configured === true, JSON.stringify(body.missing ?? []));
    check("chain reachable", body.chain?.reachable === true, `block ${body.chain?.blockNumber}`);
    check("contracts reachable", body.contracts?.reachable === true, `${body.contracts?.organizationCount} org(s)`);
    check("database reachable", body.database?.reachable === true);
  }

  // ── trust boundary ────────────────────────────────────────────────
  section("trust boundary — unauthenticated must be refused");
  {
    const anon = makeClient();
    for (const [path, opts] of [
      ["/api/identity/me", {}],
      [`/api/assets?orgId=${ORG_ID}`, {}],
      [`/api/audit?orgId=${ORG_ID}`, {}],
      ["/api/profile", {}],
      ["/api/assets", { method: "POST", body: JSON.stringify({ orgId: ORG_ID, name: "Rogue", assetType: "Laptop" }) }],
    ]) {
      const { status } = await anon(path, opts);
      check(`401 on ${opts.method ?? "GET"} ${path.split("?")[0]}`, status === 401, `got ${status}`);
    }
  }

  // ── signature rejection ───────────────────────────────────────────
  section("SIWE — forged and replayed signatures must fail");
  {
    const client = makeClient();
    const wallet = new Wallet(ACCOUNTS.employee.pk);
    const other = new Wallet(ACCOUNTS.manager.pk);

    const challenge = await client("/api/auth/nonce", {
      method: "POST",
      body: JSON.stringify({ wallet: wallet.address }),
    });
    check("nonce issued", challenge.status === 200);
    check("nonce says login is gas-free", challenge.body?.gasRequired === false);

    // Someone else signs the challenge issued to this wallet.
    const wrongSig = await other.signMessage(challenge.body.message);
    const wrongRes = await client("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ message: challenge.body.message, signature: wrongSig }),
    });
    check("wrong signer rejected", wrongRes.status === 401, wrongRes.body?.error ?? "");

    // Tampered message body.
    const tampered = challenge.body.message.replace(wallet.address, other.address);
    const tamperedSig = await other.signMessage(tampered);
    const tamperedRes = await client("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ message: tampered, signature: tamperedSig }),
    });
    check("tampered message rejected", tamperedRes.status === 401, tamperedRes.body?.error ?? "");

    // Correct signature succeeds…
    const goodSig = await wallet.signMessage(challenge.body.message);
    const first = await client("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ message: challenge.body.message, signature: goodSig }),
    });
    check("valid signature accepted", first.status === 200);

    // …but the same nonce cannot be used twice.
    const replay = await makeClient()("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ message: challenge.body.message, signature: goodSig }),
    });
    check("nonce replay rejected", replay.status === 401, replay.body?.error ?? "");
  }

  // ── admin session ─────────────────────────────────────────────────
  section(`admin session — ${ACCOUNTS.admin.label}`);
  const adminClient = makeClient();
  {
    const { wallet, verified } = await login(adminClient, ACCOUNTS.admin.pk);
    check("login succeeded", verified.status === 200, verified.body?.error ?? "");
    check("identity active on-chain", verified.body?.identity?.active === true);
    check("routed to dashboard", verified.body?.next === "dashboard", verified.body?.next);
    check("membership reported", verified.body?.memberships?.[0]?.role === "ADMIN");
    check("profile joined from Supabase", Boolean(verified.body?.profile?.display_name), verified.body?.profile?.display_name ?? "");

    const me = await adminClient("/api/identity/me");
    check("GET /api/identity/me", me.status === 200);
    check("DID derived", me.body?.identity?.did === `did:ownex:${wallet.address}`);
    check("record intact (hash anchor matches)", me.body?.identity?.recordIntact === true);
    check("root admin flagged", me.body?.memberships?.[0]?.isRootAdmin === true);
    const perms = me.body?.permissions ?? {};
    check("has MINT_ASSETS", perms.MINT_ASSETS === true);
    check("has ASSIGN_ROLES", perms.ASSIGN_ROLES === true);
    check("has MANAGE_APPS", perms.MANAGE_APPS === true);
  }

  // ── assets as admin ───────────────────────────────────────────────
  section("assets — admin view");
  {
    const res = await adminClient(`/api/assets?orgId=${ORG_ID}`);
    check("GET /api/assets", res.status === 200);
    check("three assets listed", res.body?.assets?.length === 3, `got ${res.body?.assets?.length}`);

    const laptop = res.body?.assets?.find((a) => a.tokenId === 1);
    check("chain data joined with database", laptop?.name === "Company Laptop 001", laptop?.name ?? "");
    check("owner from chain", typeof laptop?.owner === "string" && laptop.owner.startsWith("0x"));
    check("record intact", laptop?.recordIntact === true);
    check("admin sees full serial", laptop?.serialNumber === "NW-LAP-4471", laptop?.serialNumber ?? "");
  }

  // ── mint draft ────────────────────────────────────────────────────
  section("mint flow — draft preparation");
  let draft = null;
  {
    const res = await adminClient("/api/assets", {
      method: "POST",
      body: JSON.stringify({
        orgId: ORG_ID,
        name: "Verification Monitor",
        assetType: "Equipment",
        department: "Engineering",
        serialNumber: "NW-MON-9001",
      }),
    });
    draft = res.body;
    check("POST /api/assets accepted", res.status === 200, res.body?.error ?? "");
    check("assetHash returned", /^0x[0-9a-f]{64}$/i.test(draft?.assetHash ?? ""));
    check("metadataUri returned", typeof draft?.metadataUri === "string" && draft.metadataUri.includes("/api/metadata/"));
    check("mintArgs prepared for the wallet", draft?.mintArgs?.orgId === ORG_ID);

    // Confirming a token that was never minted must be refused.
    const bogus = await adminClient(`/api/assets/${draft.assetId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ tokenId: 9999, txHash: "0x" + "11".repeat(32) }),
    });
    check("confirm rejects a non-existent token", bogus.status === 400, bogus.body?.error ?? "");

    // Confirming someone else's real token must also be refused (hash mismatch).
    const wrongToken = await adminClient(`/api/assets/${draft.assetId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ tokenId: 1, txHash: "0x" + "22".repeat(32) }),
    });
    check("confirm rejects a hash mismatch", wrongToken.status === 400, wrongToken.body?.error ?? "");
  }

  // ── metadata ──────────────────────────────────────────────────────
  section("public metadata");
  {
    const anon = makeClient();
    const res = await anon("/api/metadata/1");
    check("GET /api/metadata/1", res.status === 200);
    check("ERC-721 name present", res.body?.name === "Company Laptop 001");
    check("attributes present", Array.isArray(res.body?.attributes) && res.body.attributes.length > 0);
    check("asset_hash exposed for verification", /^0x[0-9a-f]{64}$/i.test(res.body?.asset_hash ?? ""));

    const leak = JSON.stringify(res.body);
    check("no serial number leaked", !leak.includes("NW-LAP-4471"));
    check("no email leaked", !leak.includes("@northwind.example"));
    check("live holder read from chain", typeof res.body?.ownex?.holder === "string");
  }

  // ── audit ─────────────────────────────────────────────────────────
  section("audit trail");
  {
    // An incremental sync may legitimately index nothing: Hardhat replays
    // deterministically, so the same accounts sending the same calldata with the
    // same nonces produce identical transaction hashes across node restarts.
    // Already-cached rows therefore still describe the live chain.
    const sync = await adminClient("/api/audit/sync", { method: "POST", body: JSON.stringify({}) });
    check("POST /api/audit/sync", sync.status === 200, sync.body?.error ?? "");
    check(
      "incremental sync reports a count",
      typeof sync.body?.indexed === "number",
      `${sync.body?.indexed} new${sync.body?.resetDetected ? ", stale cache purged" : ""}`
    );

    // A full re-index must see every event on chain.
    const full = await adminClient("/api/audit/sync", { method: "POST", body: JSON.stringify({ fromBlock: 0 }) });
    check("full re-index sees events", (full.body?.indexed ?? 0) > 0, `${full.body?.indexed} events`);

    const audit = await adminClient(`/api/audit?orgId=${ORG_ID}&limit=200`);
    check("GET /api/audit", audit.status === 200);
    check("cache populated", (audit.body?.events?.length ?? 0) > 0, `${audit.body?.events?.length} rows`);

    const names = new Set((audit.body?.events ?? []).map((e) => e.event));
    for (const expected of ["IdentityRegistered", "OrganizationCreated", "MemberAdded", "RoleAssigned", "AssetMinted"]) {
      check(`recorded ${expected}`, names.has(expected));
    }

    const minted = (audit.body?.events ?? []).find((e) => e.event === "AssetMinted");
    check("event carries a tx hash", /^0x[0-9a-f]{64}$/i.test(minted?.txHash ?? ""));
    check("role decoded to a name", (audit.body?.events ?? []).some((e) => ["ADMIN", "MANAGER", "AUDITOR", "USER"].includes(e.payload?.role)));

    // Re-indexing the same range again must not create duplicate rows.
    await adminClient("/api/audit/sync", { method: "POST", body: JSON.stringify({ fromBlock: 0 }) });
    const after = await adminClient(`/api/audit?orgId=${ORG_ID}&limit=200`);
    check(
      "re-index is idempotent — no duplicate rows",
      after.body?.events?.length === audit.body?.events?.length,
      `${after.body?.events?.length} vs ${audit.body?.events?.length}`
    );

    // Every cached transaction must still exist on the live chain.
    const sample = (audit.body?.events ?? []).slice(0, 3);
    const stale = [];
    for (const event of sample) {
      const res = await fetch(process.env.RPC_URL ?? "http://127.0.0.1:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [event.txHash] }),
      });
      const json = await res.json();
      if (!json.result) stale.push(event.txHash);
    }
    check("cached events exist on the live chain", stale.length === 0, stale.length ? `stale: ${stale.join(", ")}` : "");
  }

  // ── plain user ────────────────────────────────────────────────────
  section(`least privilege — ${ACCOUNTS.employee.label}`);
  {
    const userClient = makeClient();
    const { verified } = await login(userClient, ACCOUNTS.employee.pk);
    check("login succeeded", verified.status === 200);
    check("role is USER", verified.body?.memberships?.[0]?.role === "USER");

    const me = await userClient("/api/identity/me");
    const perms = me.body?.permissions ?? {};
    check("no MINT_ASSETS", perms.MINT_ASSETS === false);
    check("no ASSIGN_ROLES", perms.ASSIGN_ROLES === false);
    check("no VIEW_AUDIT", perms.VIEW_AUDIT === false);
    check("holds two assets", me.body?.assets?.length === 2, JSON.stringify(me.body?.assets));

    const mint = await userClient("/api/assets", {
      method: "POST",
      body: JSON.stringify({ orgId: ORG_ID, name: "Unauthorized Asset", assetType: "Laptop" }),
    });
    check("403 on mint attempt", mint.status === 403, mint.body?.error ?? "");

    const audit = await userClient(`/api/audit?orgId=${ORG_ID}`);
    check("403 on audit trail", audit.status === 403, audit.body?.error ?? "");

    const assets = await userClient(`/api/assets?orgId=${ORG_ID}`);
    check("may list assets as a member", assets.status === 200);
    const laptop = assets.body?.assets?.find((a) => a.tokenId === 1);
    check("serial number masked for a plain user", laptop?.serialNumber !== "NW-LAP-4471", laptop?.serialNumber ?? "");
  }

  // ── manager ───────────────────────────────────────────────────────
  section(`manager — ${ACCOUNTS.manager.label}`);
  {
    const mgr = makeClient();
    await login(mgr, ACCOUNTS.manager.pk);
    const me = await mgr("/api/identity/me");
    const perms = me.body?.permissions ?? {};
    check("has TRANSFER_ASSETS", perms.TRANSFER_ASSETS === true);
    check("has VIEW_AUDIT", perms.VIEW_AUDIT === true);
    check("no MINT_ASSETS by default", perms.MINT_ASSETS === false);
    const audit = await mgr(`/api/audit?orgId=${ORG_ID}&limit=5`);
    check("may read the audit trail", audit.status === 200);
  }

  // ── members roster ────────────────────────────────────────────────
  section("members roster — GET /api/members");
  {
    const anon = makeClient();
    const noSession = await anon(`/api/members?orgId=${ORG_ID}`);
    check("401 without a session", noSession.status === 401, noSession.body?.error ?? "");

    const admin = makeClient();
    await login(admin, ACCOUNTS.admin.pk);

    const bad = await admin("/api/members?orgId=0");
    check("400 on a non-positive orgId", bad.status === 400, bad.body?.error ?? "");

    const missing = await admin("/api/members?orgId=9999");
    check("403 on an organization the caller is not in", missing.status === 403, missing.body?.error ?? "");

    const roster = await admin(`/api/members?orgId=${ORG_ID}`);
    check("admin may read the roster", roster.status === 200);

    const members = roster.body?.members ?? [];
    // The seed adds five members; the root admin created the organization and is
    // never in the contract's member list, so a correct roster has six.
    check("roster has six entries including the root admin", members.length === 6, `got ${members.length}`);

    const root = members.find((m) => m.isRootAdmin);
    check("root admin is present and flagged", Boolean(root), root?.wallet ?? "");
    check("root admin resolves to ADMIN", root?.role === "ADMIN", root?.role ?? "");
    check(
      "root admin has no stored membership record",
      root?.storedRole === "NONE",
      root?.storedRole ?? ""
    );

    const roles = members.map((m) => m.role);
    check("all four roles appear", ["ADMIN", "MANAGER", "AUDITOR", "USER"].every((r) => roles.includes(r)), roles.join(","));

    const timeBound = members.filter((m) => m.expiresAt !== null);
    check("one membership is time-bound", timeBound.length === 1, `got ${timeBound.length}`);
    check("the time-bound one has not lapsed yet", timeBound[0]?.expired === false);

    check("admin sees profile detail", roster.body?.canSeeProfiles === true);
    check(
      "a named profile came back",
      members.some((m) => m.profile?.displayName),
      ""
    );

    // A plain USER is a member, so may see the roster, but not the off-chain
    // detail — the same split the asset listing applies to serial numbers.
    const user = makeClient();
    await login(user, ACCOUNTS.employee.pk);
    const asUser = await user(`/api/members?orgId=${ORG_ID}`);
    check("a plain user may read the roster", asUser.status === 200);
    check("profiles withheld from a plain user", asUser.body?.canSeeProfiles === false);
    check(
      "no display name leaked to a plain user",
      (asUser.body?.members ?? []).every((m) => m.profile === null),
      ""
    );
    check(
      "wallets and roles are still returned",
      (asUser.body?.members ?? []).every((m) => m.wallet && m.role),
      ""
    );
  }

  // ── permission matrix ─────────────────────────────────────────────
  section("permission matrix — GET /api/roles/matrix");
  {
    const anon = makeClient();
    const noSession = await anon(`/api/roles/matrix?orgId=${ORG_ID}`);
    check("401 without a session", noSession.status === 401, noSession.body?.error ?? "");

    const admin = makeClient();
    await login(admin, ACCOUNTS.admin.pk);
    const matrix = await admin(`/api/roles/matrix?orgId=${ORG_ID}`);
    check("admin may read the matrix", matrix.status === 200);
    check("organization reads as active", matrix.body?.organisationActive === true);
    check("24 cells returned", (matrix.body?.cells ?? []).length === 24, `got ${(matrix.body?.cells ?? []).length}`);
    check("admin is told it may edit", matrix.body?.canEdit === true);

    const cell = (role, permission) =>
      (matrix.body?.cells ?? []).find((c) => c.role === role && c.permission === permission);

    // These are the defaults asserted by the contract test suite. If the matrix
    // endpoint disagrees with them, it is the endpoint that is wrong.
    check("ADMIN may mint by default", cell("ADMIN", "MINT_ASSETS")?.default === true);
    check("MANAGER may transfer by default", cell("MANAGER", "TRANSFER_ASSETS")?.default === true);
    check("MANAGER may not mint by default", cell("MANAGER", "MINT_ASSETS")?.default === false);
    check("AUDITOR may view audit by default", cell("AUDITOR", "VIEW_AUDIT")?.default === true);
    check("AUDITOR may not transfer by default", cell("AUDITOR", "TRANSFER_ASSETS")?.default === false);
    check("USER holds nothing by default", ["MANAGE_MEMBERS", "ASSIGN_ROLES", "MINT_ASSETS", "TRANSFER_ASSETS", "VIEW_AUDIT", "MANAGE_APPS"].every((p) => cell("USER", p)?.default === false));

    check(
      "a freshly seeded org has no overrides",
      (matrix.body?.cells ?? []).every((c) => c.override === "Unset"),
      ""
    );
    check(
      "effective matches default when nothing is overridden",
      (matrix.body?.cells ?? []).every((c) => c.effective === c.default),
      ""
    );

    const user = makeClient();
    await login(user, ACCOUNTS.employee.pk);
    const asUser = await user(`/api/roles/matrix?orgId=${ORG_ID}`);
    check("a plain user may read the matrix", asUser.status === 200);
    check("a plain user is not offered edit", asUser.body?.canEdit === false);
  }

  // ── role verification endpoint ────────────────────────────────────
  section("role verification endpoint — what partner apps call");
  {
    const anon = makeClient();
    const cases = [
      { pk: ACCOUNTS.admin.pk, expect: "ADMIN" },
      { pk: ACCOUNTS.manager.pk, expect: "MANAGER" },
      { pk: ACCOUNTS.employee.pk, expect: "USER" },
    ];
    for (const c of cases) {
      const address = new Wallet(c.pk).address;
      const res = await anon(`/api/roles/verify?wallet=${address}&orgId=${ORG_ID}&app=employee-portal`);
      check(`${c.expect} allowed, no session needed`, res.status === 200 && res.body?.role === c.expect && res.body?.allowed === true, res.body?.role ?? "");
      check(`${c.expect} app access granted`, res.body?.appAccess?.allowed === true);
    }

    const stranger = await anon(`/api/roles/verify?wallet=0x0000000000000000000000000000000000000123&orgId=${ORG_ID}&app=employee-portal`);
    check("stranger denied", stranger.body?.allowed === false && stranger.body?.reason === "IDENTITY_NOT_REGISTERED", stranger.body?.reason ?? "");

    const leak = JSON.stringify(stranger.body) + JSON.stringify((await anon(`/api/roles/verify?wallet=${new Wallet(ACCOUNTS.employee.pk).address}&orgId=${ORG_ID}`)).body);
    check("no email exposed to partner apps", !leak.includes("@northwind.example"));
  }

  // ── logout ────────────────────────────────────────────────────────
  section("logout");
  {
    const client = makeClient();
    await login(client, ACCOUNTS.admin.pk);
    check("session works before logout", (await client("/api/identity/me")).status === 200);
    check("POST /api/auth/logout", (await client("/api/auth/logout", { method: "POST" })).status === 200);
    check("session refused after logout", (await client("/api/identity/me")).status === 401);
  }

  // ── cleanup ───────────────────────────────────────────────────────
  // The draft created above is never minted, so remove it. Without this,
  // every run would leave another orphan row in the pending list.
  if (draft?.assetId) {
    section("cleanup");
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const { readFileSync } = await import("node:fs");
      const { dirname, join } = await import("node:path");
      const { fileURLToPath } = await import("node:url");

      const root = join(dirname(fileURLToPath(import.meta.url)), "..");
      const env = Object.fromEntries(
        readFileSync(join(root, ".env.local"), "utf8")
          .split(/\r?\n/)
          .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
          .map((l) => {
            const i = l.indexOf("=");
            return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
          })
      );

      const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
        global: { headers: { "User-Agent": "ownex-server/1.0" } },
      });

      const { error } = await sb.from("assets").delete().eq("id", draft.assetId).is("token_id", null);
      check("test draft removed", !error, error?.message ?? "");
    } catch (error) {
      check("test draft removed", false, error.message);
    }
  }

  // ── summary ───────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(58));
  console.log(`${passed} passed, ${failed} failed`);
  console.log("═".repeat(58));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nverification aborted:", error.message);
  process.exitCode = 1;
});
