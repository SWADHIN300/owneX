import { z } from "zod";
import { handler, okNoStore, readJson, badRequest, notFound, ApiError } from "@/lib/http";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/supabase";
import { readAsset } from "@/lib/chain";

const bodySchema = z.object({
  tokenId: z.number().int().positive(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

/**
 * POST /api/assets/<assetId>/confirm
 *
 * Binds a draft row to a real token after the mint transaction lands.
 *
 * The client's claim is not taken on trust. The server reads the token from the
 * chain and refuses to bind unless the on-chain asset hash matches the hash
 * stored on the draft — so a caller cannot attach their record to somebody
 * else's token, and cannot claim a token that does not exist.
 */
export const POST = handler(async (request: Request, context: { params: Promise<{ assetId: string }> }) => {
  const { assetId } = await context.params;
  const body = bodySchema.parse(await readJson(request));

  const supabase = db();
  const { data: draft, error } = await supabase
    .from("assets")
    .select("id, org_id, token_id, asset_hash, name")
    .eq("id", assetId)
    .maybeSingle();

  if (error) throw new ApiError(500, "Could not load asset draft");
  if (!draft) throw notFound("Asset draft not found");
  if (draft.token_id !== null) {
    throw badRequest(`This asset is already bound to token #${draft.token_id}`);
  }

  await requirePermission(Number(draft.org_id), "MINT_ASSETS");

  // ── Verify against the chain before believing anything ──────────────
  const chainAsset = await readAsset(body.tokenId);
  if (!chainAsset) throw badRequest(`Token #${body.tokenId} does not exist on-chain yet`);

  if (chainAsset.orgId !== Number(draft.org_id)) {
    throw badRequest("That token belongs to a different organization");
  }
  if (chainAsset.assetHash.toLowerCase() !== draft.asset_hash.toLowerCase()) {
    throw badRequest("On-chain asset hash does not match this draft — refusing to bind");
  }

  const { error: bindError } = await supabase
    .from("assets")
    .update({ token_id: body.tokenId, mint_tx_hash: body.txHash })
    .eq("id", assetId)
    .is("token_id", null);

  if (bindError) throw new ApiError(500, `Could not bind token: ${bindError.message}`);

  return okNoStore({
    assetId,
    tokenId: body.tokenId,
    txHash: body.txHash,
    owner: chainAsset.owner,
    assignedTo: chainAsset.assignedTo,
    assetHash: chainAsset.assetHash,
    verified: true,
  });
});
