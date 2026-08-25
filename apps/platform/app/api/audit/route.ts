import { z } from "zod";
import { handler, okNoStore, badRequest } from "@/lib/http";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/supabase";
import { publicEnv } from "@/lib/env";

/**
 * GET /api/audit?orgId=1&event=AssetMinted&wallet=0x…&limit=50&cursor=<block>
 *
 * Paged audit history from the cache. Requires VIEW_AUDIT in the organization,
 * which by default means Admin, Manager, or Auditor — a plain User cannot read
 * the organization's history.
 *
 * Every row carries its transaction hash and block number so any entry can be
 * checked independently on a block explorer. That is the difference between
 * this and a normal application log: nobody, including us, can alter it.
 */

const querySchema = z.object({
  orgId: z.coerce.number().int().positive(),
  event: z.string().max(60).optional(),
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  tokenId: z.coerce.number().int().positive().optional(),
  contract: z.enum(["IdentityRegistry", "OrgAccessManager", "AssetNFT"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().nonnegative().optional(),
});

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) throw badRequest("orgId is required; limit must be 1–200");

  const { orgId, event, wallet, tokenId, contract, limit, cursor } = parsed.data;

  await requirePermission(orgId, "VIEW_AUDIT");

  let query = db()
    .from("audit_cache")
    .select("id, contract_name, event_name, org_id, actor_wallet, subject_wallet, token_id, tx_hash, block_number, log_index, payload, created_at")
    .order("block_number", { ascending: false })
    .order("log_index", { ascending: false })
    .limit(limit + 1); // one extra row tells us whether more exist

  // Organization-scoped events, plus asset events which carry no orgId.
  query = query.or(`org_id.eq.${orgId},org_id.is.null`);

  if (event) query = query.eq("event_name", event);
  if (contract) query = query.eq("contract_name", contract);
  if (tokenId !== undefined) query = query.eq("token_id", tokenId);
  if (wallet) {
    const lower = wallet.toLowerCase();
    query = query.or(`actor_wallet.eq.${lower},subject_wallet.eq.${lower}`);
  }
  if (cursor !== undefined) query = query.lt("block_number", cursor);

  const { data, error } = await query;
  if (error) throw badRequest(`Could not read audit history: ${error.message}`);

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const explorer = publicEnv.NEXT_PUBLIC_EXPLORER_URL;

  return okNoStore({
    orgId,
    count: page.length,
    hasMore,
    nextCursor: hasMore ? Number(page[page.length - 1].block_number) : null,
    events: page.map((row) => ({
      id: row.id,
      contract: row.contract_name,
      event: row.event_name,
      orgId: row.org_id === null ? null : Number(row.org_id),
      actor: row.actor_wallet,
      subject: row.subject_wallet,
      tokenId: row.token_id === null ? null : Number(row.token_id),
      txHash: row.tx_hash,
      blockNumber: Number(row.block_number),
      payload: row.payload,
      explorerUrl: explorer ? `${explorer.replace(/\/$/, "")}/tx/${row.tx_hash}` : null,
    })),
  });
});
