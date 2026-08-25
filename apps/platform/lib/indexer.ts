import type { Contract, Log, EventLog } from "ethers";
import { db } from "./supabase";
import { serverEnv } from "./env";
import { identityRegistry, accessManager, assetNFT, roleName, provider } from "./chain";

/**
 * Event indexer.
 *
 * The chain is the authoritative audit trail. This copies events into Postgres
 * so the Audit Trail page can page and filter instantly instead of hitting an
 * RPC provider on every scroll. If the cache is wiped, it can be rebuilt from
 * the chain — nothing is lost, which is the whole point of on-chain events.
 *
 * Idempotent: `unique (tx_hash, log_index)` means re-running is safe.
 */

const CHUNK = 2000; // block range per query — public RPCs reject wide ranges

type Indexable = {
  name: "IdentityRegistry" | "OrgAccessManager" | "AssetNFT";
  contract: Contract;
};

/** Pulls the audit-relevant fields out of each event we care about. */
function extract(contractName: string, log: EventLog) {
  const args = log.args;
  const str = (v: unknown) => (v === undefined || v === null ? null : String(v));
  const num = (v: unknown) => (v === undefined || v === null ? null : Number(v));

  switch (log.eventName) {
    // ── IdentityRegistry ──────────────────────────────────────────
    case "IdentityRegistered":
      return { orgId: null, actor: str(args[2]), subject: str(args[0]), tokenId: null };
    case "IdentityHashUpdated":
      return { orgId: null, actor: str(args[3]), subject: str(args[0]), tokenId: null };
    case "IdentityRevoked":
    case "IdentityReactivated":
      return { orgId: null, actor: str(args[1]), subject: str(args[0]), tokenId: null };
    case "OrganizationCreated":
      return { orgId: num(args[0]), actor: str(args[1]), subject: str(args[1]), tokenId: null };
    case "OrganizationStatusChanged":
      return { orgId: num(args[0]), actor: str(args[2]), subject: null, tokenId: null };
    case "OrgRootAdminTransferred":
      return { orgId: num(args[0]), actor: str(args[1]), subject: str(args[2]), tokenId: null };
    case "OrganizationMetadataUpdated":
      return { orgId: num(args[0]), actor: null, subject: null, tokenId: null };
    case "RegistrarUpdated":
      return { orgId: null, actor: null, subject: str(args[0]), tokenId: null };

    // ── OrgAccessManager ──────────────────────────────────────────
    case "MemberAdded":
      return { orgId: num(args[0]), actor: str(args[4]), subject: str(args[1]), tokenId: null };
    case "MemberRemoved":
      return { orgId: num(args[0]), actor: str(args[3]), subject: str(args[1]), tokenId: null };
    case "RoleAssigned":
      return { orgId: num(args[0]), actor: str(args[5]), subject: str(args[1]), tokenId: null };
    case "RoleExpiryUpdated":
      return { orgId: num(args[0]), actor: str(args[4]), subject: str(args[1]), tokenId: null };
    case "PermissionUpdated":
      return { orgId: num(args[0]), actor: str(args[4]), subject: null, tokenId: null };
    case "ApplicationRegistered":
      return { orgId: num(args[0]), actor: str(args[3]), subject: null, tokenId: null };
    case "AppAccessChanged":
      return { orgId: num(args[0]), actor: str(args[4]), subject: null, tokenId: null };

    // ── AssetNFT ──────────────────────────────────────────────────
    case "AssetMinted":
      return { orgId: num(args[1]), actor: str(args[5]), subject: str(args[2]), tokenId: num(args[0]) };
    case "AssetAssigned":
      return { orgId: null, actor: str(args[3]), subject: str(args[2]), tokenId: num(args[0]) };
    case "AssetRevoked":
      return { orgId: null, actor: str(args[3]), subject: str(args[1]), tokenId: num(args[0]) };
    case "AssetRestored":
      return { orgId: null, actor: str(args[2]), subject: str(args[1]), tokenId: num(args[0]) };
    case "AssetMetadataUpdated":
      return { orgId: null, actor: str(args[4]), subject: null, tokenId: num(args[0]) };

    default:
      return { orgId: null, actor: null, subject: null, tokenId: null };
  }
}

/** Events worth showing a human. ERC-721 Transfer/Approval noise is skipped. */
const TRACKED = new Set([
  "IdentityRegistered",
  "IdentityHashUpdated",
  "IdentityRevoked",
  "IdentityReactivated",
  "RegistrarUpdated",
  "OrganizationCreated",
  "OrganizationMetadataUpdated",
  "OrganizationStatusChanged",
  "OrgRootAdminTransferred",
  "MemberAdded",
  "MemberRemoved",
  "RoleAssigned",
  "RoleExpiryUpdated",
  "PermissionUpdated",
  "ApplicationRegistered",
  "AppAccessChanged",
  "AssetMinted",
  "AssetAssigned",
  "AssetRevoked",
  "AssetRestored",
  "AssetMetadataUpdated",
]);

function isEventLog(log: Log | EventLog): log is EventLog {
  return "eventName" in log && typeof (log as EventLog).eventName === "string";
}

/** Turns raw event args into something readable in the audit UI. */
function readablePayload(log: EventLog): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fragment = log.fragment;

  fragment.inputs.forEach((input, i) => {
    const value = log.args[i];
    if (typeof value === "bigint") {
      out[input.name] = Number(value);
    } else if (input.type === "bytes32" && input.name.toLowerCase().includes("role")) {
      out[input.name] = roleName(String(value));
    } else {
      out[input.name] = String(value);
    }
  });

  return out;
}

export type SyncResult = {
  chainId: number;
  fromBlock: number;
  toBlock: number;
  indexed: number;
  perContract: Record<string, number>;
  resetDetected: boolean;
};

/**
 * Detects that the chain behind the cache has been replaced.
 *
 * Restarting a local Hardhat node resets block numbers to zero while producing
 * entirely new transaction hashes. Height alone therefore cannot tell you the
 * chain is different — a cached `last_block` of 26 looks perfectly valid against
 * a brand-new chain that also happens to be at block 26, so the indexer would
 * skip everything and the dead chain's events would linger forever beside live
 * ones.
 *
 * Instead, take the most recent cached transaction and ask the chain whether it
 * exists. If it does not, the cache belongs to a chain that is gone: drop those
 * rows and re-index from zero. Costs one RPC call per sync and makes local
 * development safe to restart.
 */
async function detectChainReset(contractName: string): Promise<boolean> {
  const supabase = db();

  const { data: newest } = await supabase
    .from("audit_cache")
    .select("tx_hash")
    .eq("contract_name", contractName)
    .order("block_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!newest?.tx_hash) return false; // nothing cached, nothing to invalidate

  const receipt = await provider().getTransactionReceipt(newest.tx_hash);
  return receipt === null;
}

async function purgeContractCache(contractName: string, contractAddress: string): Promise<void> {
  const supabase = db();
  await supabase.from("audit_cache").delete().eq("contract_name", contractName);
  await supabase.from("indexer_state").delete().eq("contract_address", contractAddress);
}

export async function syncEvents(options: { fromBlock?: number } = {}): Promise<SyncResult> {
  const env = serverEnv();
  const supabase = db();

  const contracts: Indexable[] = [
    { name: "IdentityRegistry", contract: identityRegistry() },
    { name: "OrgAccessManager", contract: accessManager() },
    { name: "AssetNFT", contract: assetNFT() },
  ];

  const latest = await provider().getBlockNumber();
  const perContract: Record<string, number> = {};
  let total = 0;
  let overallFrom = latest;
  let resetDetected = false;

  for (const { name, contract } of contracts) {
    const address = await contract.getAddress();

    // Invalidate the cache if it describes a chain that no longer exists.
    if (await detectChainReset(name)) {
      await purgeContractCache(name, address);
      resetDetected = true;
    }

    const { data: state } = await supabase
      .from("indexer_state")
      .select("last_block")
      .eq("contract_address", address)
      .maybeSingle();

    let from = options.fromBlock ?? (state ? Number(state.last_block) + 1 : 0);
    // A stored height beyond the chain tip also means the chain was replaced.
    if (from > latest + 1) {
      await purgeContractCache(name, address);
      resetDetected = true;
      from = 0;
    }

    overallFrom = Math.min(overallFrom, from);
    let indexedHere = 0;

    for (let start = from; start <= latest; start += CHUNK) {
      const end = Math.min(start + CHUNK - 1, latest);
      const logs = await contract.queryFilter("*", start, end);

      const rows = [];
      for (const log of logs) {
        if (!isEventLog(log)) continue;
        if (!TRACKED.has(log.eventName)) continue;

        const fields = extract(name, log);
        rows.push({
          contract_name: name,
          event_name: log.eventName,
          org_id: fields.orgId,
          actor_wallet: fields.actor?.toLowerCase() ?? null,
          subject_wallet: fields.subject?.toLowerCase() ?? null,
          token_id: fields.tokenId,
          tx_hash: log.transactionHash,
          block_number: log.blockNumber,
          log_index: log.index,
          payload: readablePayload(log),
        });
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from("audit_cache")
          .upsert(rows, { onConflict: "tx_hash,log_index", ignoreDuplicates: true });
        if (error) throw new Error(`Indexing failed for ${name}: ${error.message}`);
        indexedHere += rows.length;
      }
    }

    await supabase.from("indexer_state").upsert(
      {
        contract_address: address,
        contract_name: name,
        chain_id: env.CHAIN_ID,
        last_block: latest,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "contract_address" }
    );

    perContract[name] = indexedHere;
    total += indexedHere;
  }

  return { chainId: env.CHAIN_ID, fromBlock: overallFrom, toBlock: latest, indexed: total, perContract, resetDetected };
}
