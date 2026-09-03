/**
 * Reconciles `assets.token_id` with what AssetNFT actually holds.
 *
 *   node scripts/repair-asset-bindings.mjs          # report only, changes nothing
 *   node scripts/repair-asset-bindings.mjs --apply  # write the repairs
 *
 *   --scan[=blocks]        recover mint tx hashes from AssetMinted events
 *                          (off by default: free RPC tiers cap eth_getLogs at a
 *                          handful of blocks, so a wide scan is thousands of calls)
 *   --tx <tokenId>=<hash>  supply a mint tx hash directly, repeatable
 *
 * WHY THIS EXISTS
 *   A token id is unique within one contract on one chain, not globally. Every
 *   AssetNFT deployment starts counting at 1, so after a redeploy the store still
 *   holds rows bound to ids that now belong to different assets. Those rows block
 *   the mint confirm step — the token is minted and paid for, but the record it
 *   describes cannot be attached to it.
 *
 * WHAT IT DOES
 *   1. Reads every token on the configured deployment.
 *   2. Releases rows whose anchor the chain contradicts (back to drafts —
 *      nothing is deleted, no confidential field is touched).
 *   3. Stamps rows the chain confirms with the deployment they belong to.
 *   4. Binds unbound drafts to the token that carries their anchor, filling in
 *      the mint transaction hash from the AssetMinted event.
 *
 *   The anchor is the only thing that decides a binding. That is the same rule
 *   the confirm endpoint applies, so this script cannot create a binding the
 *   server would consider invalid.
 *
 * Idempotent: a second run reports nothing to do.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { Contract, JsonRpcProvider } from "ethers";

const APPLY = process.argv.includes("--apply");

/**
 * `--scan` / `--scan=1500`  look for the AssetMinted events in the last N blocks
 * `--tx 5=0xabc…`           name a mint transaction hash outright
 */
const SCAN_ARG = process.argv.find((arg) => arg === "--scan" || arg.startsWith("--scan="));
const SCAN_BLOCKS = SCAN_ARG ? Number(SCAN_ARG.split("=")[1] ?? 300) : 0;

const TX_HASHES = new Map();
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] !== "--tx") continue;
  const [tokenId, hash] = (process.argv[i + 1] ?? "").split("=");
  if (!/^\d+$/.test(tokenId ?? "") || !/^0x[0-9a-fA-F]{64}$/.test(hash ?? "")) {
    console.error(`--tx expects <tokenId>=<0x…64 hex>, got "${process.argv[i + 1]}"`);
    process.exit(1);
  }
  TX_HASHES.set(Number(tokenId), hash);
}

if (Number.isNaN(SCAN_BLOCKS) || SCAN_BLOCKS < 0) {
  console.error("--scan expects a positive block count");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// ── env ───────────────────────────────────────────────────────────────
const envFile = process.env.OWNEX_ENV_FILE ? join(process.cwd(), process.env.OWNEX_ENV_FILE) : join(root, ".env.local");
if (!existsSync(envFile)) {
  console.error(`No environment file at ${envFile}. Copy .env.local.example and fill it in.`);
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RPC_URL", "CHAIN_ID", "ASSET_NFT_ADDRESS"]) {
  if (!env[key]) {
    console.error(`${key} is missing from ${envFile}`);
    process.exit(1);
  }
}

const CHAIN_ID = Number(env.CHAIN_ID);
const ASSET_NFT = env.ASSET_NFT_ADDRESS.toLowerCase();

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "User-Agent": "ownex-server/1.0" } },
});

const abi = JSON.parse(readFileSync(join(root, "lib", "chain", "abis", "AssetNFT.json"), "utf8"));
const provider = new JsonRpcProvider(env.RPC_URL, CHAIN_ID, { staticNetwork: true });
const nft = new Contract(env.ASSET_NFT_ADDRESS, abi, provider);

const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const isUnknownColumn = (error) => error?.code === "PGRST204" || error?.code === "42703";

/* ── what the chain holds ──────────────────────────────────────────── */

async function readChainTokens() {
  const total = Number(await nft.totalMinted());
  const tokens = new Map();

  for (let tokenId = 1; tokenId <= total; tokenId += 1) {
    const record = await nft.getAsset(tokenId);
    const orgId = Number(record.orgId);
    if (orgId === 0) continue; // burned or never minted
    tokens.set(tokenId, { tokenId, orgId, assetHash: String(record.assetHash), txHash: null });
  }

  return tokens;
}

/**
 * Mint transaction hashes, from the events themselves.
 *
 * Off by default. Providers cap the block range of a single eth_getLogs call —
 * Alchemy's free tier allows ten blocks — so a wide scan is thousands of requests
 * and not something a repair should do unasked. Pass `--scan` (optionally
 * `--scan=1500`) when the mints are recent, or name them outright with
 * `--tx 5=0xabc…`.
 *
 * A missing hash is not fatal. The binding is decided by the anchor; the hash is
 * only a link for the audit trail.
 */
async function readMintTxHashes(tokens, lookBack) {
  const wanted = new Set(tokens.keys());
  if (wanted.size === 0 || lookBack === 0) return;

  // Same window the indexer uses, for the same reason: public Sepolia endpoints
  // reject anything wider.
  const CHUNK = CHAIN_ID === 11155111 ? 10 : 2000;
  const latest = await provider.getBlockNumber();
  const floor = Math.max(0, latest - lookBack);
  console.log(`scanning blocks ${floor}–${latest} for AssetMinted, ${CHUNK} at a time…`);

  for (let to = latest; to >= floor && wanted.size > 0; to -= CHUNK) {
    const from = Math.max(floor, to - CHUNK + 1);
    let events;
    try {
      events = await nft.queryFilter(nft.filters.AssetMinted(), from, to);
    } catch (error) {
      console.log(`  (scan stopped at blocks ${from}–${to}: ${error.shortMessage ?? error.message})`);
      return;
    }

    for (const event of events) {
      const tokenId = Number(event.args[0]);
      if (!wanted.has(tokenId)) continue;
      tokens.get(tokenId).txHash = event.transactionHash;
      wanted.delete(tokenId);
    }
  }

  if (wanted.size > 0) {
    console.log(`  (no AssetMinted event in that range for token ${[...wanted].join(", ")})`);
  }
}

/* ── what the store holds ──────────────────────────────────────────── */

async function readRows() {
  const scoped = await sb
    .from("assets")
    .select("id, token_id, org_id, name, asset_hash, mint_tx_hash, chain_id, contract_address, created_at")
    .order("created_at", { ascending: true });

  if (!scoped.error) return { rows: scoped.data, scoped: true };
  if (!isUnknownColumn(scoped.error)) throw new Error(scoped.error.message);

  const legacy = await sb
    .from("assets")
    .select("id, token_id, org_id, name, asset_hash, mint_tx_hash, created_at")
    .order("created_at", { ascending: true });
  if (legacy.error) throw new Error(legacy.error.message);
  return { rows: legacy.data, scoped: false };
}

async function update(id, patch, scoped) {
  if (!APPLY) return;

  const attempt = await sb.from("assets").update(patch).eq("id", id);
  if (!attempt.error) return;

  // Migration 0002 not applied: write the binding without the deployment stamp.
  if (scoped && isUnknownColumn(attempt.error)) {
    const rest = Object.fromEntries(
      Object.entries(patch).filter(([column]) => column !== "chain_id" && column !== "contract_address")
    );
    if (Object.keys(rest).length === 0) return;
    const retry = await sb.from("assets").update(rest).eq("id", id);
    if (retry.error) throw new Error(`${id}: ${retry.error.message}`);
    return;
  }

  throw new Error(`${id}: ${attempt.error.message}`);
}

/* ── the repair ────────────────────────────────────────────────────── */

async function main() {
  console.log("─".repeat(72));
  console.log(`AssetNFT   ${env.ASSET_NFT_ADDRESS}  (chain ${CHAIN_ID})`);
  console.log(`store      ${env.SUPABASE_URL}`);
  console.log(`mode       ${APPLY ? "APPLY — the store will be written" : "DRY RUN — nothing will be written"}`);
  console.log("─".repeat(72));

  const tokens = await readChainTokens();
  for (const [tokenId, hash] of TX_HASHES) {
    if (tokens.has(tokenId)) tokens.get(tokenId).txHash = hash;
  }
  await readMintTxHashes(tokens, SCAN_BLOCKS);
  const { rows, scoped } = await readRows();

  if (!scoped) {
    console.log("\nNote: assets.contract_address is absent, so migration 0002 has not been");
    console.log("applied. Bindings will be repaired, but nothing stamps them as belonging to");
    console.log("this deployment, so the same collision can return after the next redeploy.");
  }

  console.log(`\n${tokens.size} token(s) on chain, ${rows.length} row(s) in the store.\n`);

  const released = [];
  const stamped = [];
  const bound = [];
  const kept = [];

  // ── 1. rows the chain contradicts go back to being drafts ─────────
  for (const row of rows.filter((r) => r.token_id !== null)) {
    const token = tokens.get(Number(row.token_id));
    const belongsElsewhere = scoped && row.contract_address && !same(row.contract_address, ASSET_NFT);

    if (belongsElsewhere) {
      kept.push(`#${row.token_id} ${row.name} — stamped for ${row.contract_address}, left alone`);
      continue;
    }

    if (!token) {
      released.push({ row, why: `token #${row.token_id} does not exist on this deployment` });
      continue;
    }
    if (!same(token.assetHash, row.asset_hash)) {
      released.push({ row, why: `token #${row.token_id} anchors ${token.assetHash.slice(0, 14)}…, the row anchors ${String(row.asset_hash).slice(0, 14)}…` });
      continue;
    }
    if (Number(token.orgId) !== Number(row.org_id)) {
      released.push({ row, why: `token #${row.token_id} belongs to org ${token.orgId}, the row to org ${row.org_id}` });
      continue;
    }

    // Verified. Stamp it if the stamp is missing.
    if (scoped && (!row.contract_address || !row.chain_id)) {
      stamped.push(row);
    } else {
      kept.push(`#${row.token_id} ${row.name} — verified`);
    }
  }

  for (const { row, why } of released) {
    console.log(`release  ${String(row.token_id).padStart(4)}  ${row.name}\n         ${why}`);
    await update(row.id, { token_id: null, mint_tx_hash: null }, false);
  }

  for (const row of stamped) {
    console.log(`stamp    ${String(row.token_id).padStart(4)}  ${row.name}`);
    await update(row.id, { chain_id: CHAIN_ID, contract_address: ASSET_NFT }, true);
  }

  // ── 2. unbound drafts that match a token nobody holds ─────────────
  const releasedIds = new Set(released.map((r) => r.row.id));
  const stillBound = new Set(
    rows
      .filter((r) => r.token_id !== null && !releasedIds.has(r.id))
      .filter((r) => !(scoped && r.contract_address && !same(r.contract_address, ASSET_NFT)))
      .map((r) => Number(r.token_id))
  );

  const drafts = rows.filter((r) => r.token_id === null || releasedIds.has(r.id));

  // Oldest draft first, lowest token id first, so a repeated run pairs the same
  // way and a retried mint does not shuffle which record owns which token.
  const claimable = [...tokens.values()].filter((t) => !stillBound.has(t.tokenId)).sort((a, b) => a.tokenId - b.tokenId);
  const takenDrafts = new Set();

  for (const token of claimable) {
    const draft = drafts.find(
      (d) => !takenDrafts.has(d.id) && Number(d.org_id) === token.orgId && same(d.asset_hash, token.assetHash)
    );
    if (!draft) {
      console.log(`orphan   ${String(token.tokenId).padStart(4)}  on-chain token with no matching record (anchor ${token.assetHash.slice(0, 14)}…)`);
      continue;
    }

    takenDrafts.add(draft.id);
    bound.push({ token, draft });
    console.log(
      `bind     ${String(token.tokenId).padStart(4)}  ${draft.name}  ${draft.id}` +
        (token.txHash ? `\n         tx ${token.txHash}` : "\n         (mint tx hash not found in the scanned range)")
    );

    await update(
      draft.id,
      {
        token_id: token.tokenId,
        mint_tx_hash: token.txHash ?? null,
        chain_id: CHAIN_ID,
        contract_address: ASSET_NFT,
      },
      true
    );
  }

  const unbound = drafts.filter((d) => !takenDrafts.has(d.id));

  // ── summary ───────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log(`released      ${released.length}   stale bindings the chain contradicted`);
  console.log(`stamped       ${stamped.length}   verified bindings marked with this deployment`);
  console.log(`bound         ${bound.length}   records attached to the token holding their anchor`);
  console.log(`left as-is    ${kept.length}`);
  console.log(`still drafts  ${unbound.length}   (never minted, or minted with a duplicate record)`);
  console.log("─".repeat(72));

  if (!APPLY && released.length + stamped.length + bound.length > 0) {
    console.log("\nNothing was written. Re-run with --apply to make these changes.");
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
