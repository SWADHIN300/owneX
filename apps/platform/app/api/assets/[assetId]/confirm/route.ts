import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { handler, okNoStore, readJson, badRequest, notFound, conflict, ApiError } from "@/lib/http";
import { requirePermission } from "@/lib/authz";
import { db, isUniqueViolation, isUnknownColumn } from "@/lib/supabase";
import { assetDeployment, readAsset, type AssetDeployment } from "@/lib/chain";
import { classifyClaim } from "@/lib/asset-binding";

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
 *
 * A token id is unique only within one contract on one chain. Redeploy AssetNFT
 * and the ids start again at 1, which leaves rows bound to tokens that no longer
 * exist and which then block the new mint that legitimately owns that id. The
 * chain is the source of truth for a binding, so a claim the chain contradicts
 * is released here rather than being allowed to wedge minting.
 */
export const POST = handler(async (request: Request, context: { params: Promise<{ assetId: string }> }) => {
  const { assetId } = await context.params;
  const body = bodySchema.parse(await readJson(request));

  const supabase = db();
  const deployment = assetDeployment();

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

  // ── Nothing else may hold this token id on this deployment ──────────
  await releaseContradictedClaims({
    supabase,
    tokenId: body.tokenId,
    chainAssetHash: chainAsset.assetHash,
    keepAssetId: assetId,
    deployment,
  });

  await bindToken({ supabase, assetId, tokenId: body.tokenId, txHash: body.txHash, deployment });

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

/* -------------------------------------------------------------------------- */

type ClaimRow = { id: string; name: string; asset_hash: string; contract_address?: string | null };

/**
 * Rows other than this draft that claim the same token id.
 *
 * Rows stamped with a different contract address describe a different
 * deployment's token and are none of this deployment's business, so they are
 * left alone. Rows with no stamp predate the deployment-scoping migration and
 * are judged by their anchor instead.
 */
async function readClaims(
  supabase: SupabaseClient,
  tokenId: number,
  keepAssetId: string
): Promise<ClaimRow[]> {
  const scoped = await supabase
    .from("assets")
    .select("id, name, asset_hash, contract_address")
    .eq("token_id", tokenId)
    .neq("id", keepAssetId);

  if (scoped.error && !isUnknownColumn(scoped.error)) {
    throw new ApiError(500, `Could not check what already claims token #${tokenId}`);
  }

  if (!scoped.error) return scoped.data as ClaimRow[];

  const legacy = await supabase
    .from("assets")
    .select("id, name, asset_hash")
    .eq("token_id", tokenId)
    .neq("id", keepAssetId);

  if (legacy.error) throw new ApiError(500, `Could not check what already claims token #${tokenId}`);
  return legacy.data as ClaimRow[];
}

async function releaseContradictedClaims({
  supabase,
  tokenId,
  chainAssetHash,
  keepAssetId,
  deployment,
}: {
  supabase: SupabaseClient;
  tokenId: number;
  chainAssetHash: string;
  keepAssetId: string;
  deployment: AssetDeployment;
}): Promise<void> {
  const claims = await readClaims(supabase, tokenId, keepAssetId);

  for (const claim of claims) {
    const verdict = classifyClaim(
      { assetHash: claim.asset_hash, contractAddress: claim.contract_address },
      chainAssetHash,
      deployment.contractAddress
    );

    // Another deployment's token id. Nothing to do, and nothing to complain
    // about: after migration 0002 the two can coexist.
    if (verdict === "other-deployment") continue;

    // The chain agrees with the other row, so both records describe this token
    // and the ambiguity is real. Refusing is the only honest answer: silently
    // moving the binding would detach a record somebody is already relying on.
    if (verdict === "conflict") {
      throw conflict(
        `Token #${tokenId} is already bound to another record ("${claim.name}") with the same anchor. ` +
          `Nothing was changed. Delete or rebind that record if this draft should own the token.`
      );
    }

    // The chain contradicts the other row: its anchor is not what this token
    // holds, so the binding is stale — almost always a row left over from a
    // previous AssetNFT deployment, where this id belonged to another asset.
    const { error: releaseError } = await supabase
      .from("assets")
      .update({ token_id: null, mint_tx_hash: null })
      .eq("id", claim.id)
      .eq("token_id", tokenId);

    if (releaseError) {
      throw new ApiError(500, `Could not release a stale claim on token #${tokenId}`);
    }

    console.warn(
      `[ownex] released stale binding on token #${tokenId}: row ${claim.id} ("${claim.name}") ` +
        `anchors ${claim.asset_hash}, but ${deployment.contractAddress} holds ${chainAssetHash}. ` +
        `The row is back to a draft; the contract was most likely redeployed.`
    );
  }
}

/**
 * Writes the binding, stamped with the deployment it belongs to.
 *
 * `is("token_id", null)` keeps two simultaneous confirms from both binding, and
 * the deployment columns are dropped if the database has not had migration 0002
 * applied yet, so a deploy that runs ahead of the SQL still binds correctly.
 */
async function bindToken({
  supabase,
  assetId,
  tokenId,
  txHash,
  deployment,
}: {
  supabase: SupabaseClient;
  assetId: string;
  tokenId: number;
  txHash: string;
  deployment: AssetDeployment;
}): Promise<void> {
  const binding = { token_id: tokenId, mint_tx_hash: txHash };

  let result = await supabase
    .from("assets")
    .update({ ...binding, chain_id: deployment.chainId, contract_address: deployment.contractAddress })
    .eq("id", assetId)
    .is("token_id", null)
    .select("id");

  if (result.error && isUnknownColumn(result.error)) {
    result = await supabase
      .from("assets")
      .update(binding)
      .eq("id", assetId)
      .is("token_id", null)
      .select("id");
  }

  if (result.error) {
    if (isUniqueViolation(result.error)) {
      throw conflict(
        `Token #${tokenId} is already recorded against another asset, so this record was left unbound. ` +
          `Run "npm run repair:assets" to reconcile the store with ${deployment.contractAddress}.`
      );
    }
    console.error(`[ownex] binding token #${tokenId} to ${assetId} failed:`, result.error);
    throw new ApiError(500, `Could not bind token #${tokenId}`);
  }

  if (!result.data?.length) {
    throw conflict(
      `Token #${tokenId} was not bound: this record stopped being a draft while the mint was confirming.`
    );
  }
}
