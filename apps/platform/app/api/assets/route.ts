import { z } from "zod";
import { handler, okNoStore, readJson, badRequest, ApiError } from "@/lib/http";
import { requireMember, requirePermission } from "@/lib/authz";
import { db, normalizeAddress, isUnknownColumn } from "@/lib/supabase";
import { encryptPII, maskTail, decryptPII } from "@/lib/crypto";
import { hashAssetRecord } from "@/lib/hash";
import { serverEnv } from "@/lib/env";
import { assetDeployment, readAsset, readAssetsOfOrganization } from "@/lib/chain";

/**
 * GET  /api/assets?orgId=1   — list an organization's assets
 * POST /api/assets           — draft an asset, ready to mint
 *
 * The listing joins two sources and is explicit about which wins: ownership,
 * active status, and the hash come from the chain; names, images, and
 * descriptions come from Supabase. If a row's stored hash no longer matches the
 * on-chain anchor, the asset is flagged as tampered rather than silently shown.
 *
 * Rows are matched to tokens only within the AssetNFT deployment this server is
 * configured for. A token id from a previous deployment describes a different
 * asset, and joining across the two would put an old record's name on a new
 * token.
 */

const ROW_FIELDS =
  "id, token_id, name, description, asset_type, department, image_url, asset_hash, metadata_uri, serial_encrypted, created_at";

type AssetRow = {
  id: string;
  token_id: number | null;
  name: string;
  description: string | null;
  asset_type: string;
  department: string | null;
  image_url: string | null;
  asset_hash: string;
  metadata_uri: string | null;
  serial_encrypted: string | null;
  created_at: string;
  contract_address?: string | null;
};

/**
 * An organization's rows, restricted to this deployment.
 *
 * Rows with no stamp predate migration 0002 and are kept: dropping them would
 * blank out names for assets minted before the column existed. `npm run
 * repair:assets` stamps them once it has checked each one against the chain.
 */
async function readOrgRows(orgId: number): Promise<AssetRow[]> {
  const deployment = assetDeployment();

  const scoped = await db().from("assets").select(`${ROW_FIELDS}, contract_address`).eq("org_id", orgId);

  if (!scoped.error) {
    return (scoped.data as AssetRow[]).filter(
      (row) => !row.contract_address || row.contract_address.toLowerCase() === deployment.contractAddress
    );
  }

  if (!isUnknownColumn(scoped.error)) throw new ApiError(500, "Could not load assets");

  const legacy = await db().from("assets").select(ROW_FIELDS).eq("org_id", orgId);
  if (legacy.error) throw new ApiError(500, "Could not load assets");
  return legacy.data as AssetRow[];
}


// ── GET ────────────────────────────────────────────────────────────────────

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const orgId = Number(url.searchParams.get("orgId"));
  if (!Number.isInteger(orgId) || orgId <= 0) throw badRequest("orgId is required");

  // Any member may list; the confidential fields stay masked unless permitted.
  const caller = await requireMember(orgId);
  const canSeeSerials = caller.role === "ADMIN" || caller.role === "MANAGER";

  const tokenIds = await readAssetsOfOrganization(orgId);

  const [rows, chainAssets] = await Promise.all([
    readOrgRows(orgId),
    Promise.all(tokenIds.map((id) => readAsset(id))),
  ]);

  const byToken = new Map<number, AssetRow>();
  for (const row of rows) {
    if (row.token_id === null) continue;
    const tokenId = Number(row.token_id);
    const held = byToken.get(tokenId);
    // A row stamped with this deployment beats an unstamped one holding the same
    // id: the stamp is evidence, the absent stamp is only an assumption.
    if (!held || (!held.contract_address && row.contract_address)) byToken.set(tokenId, row);
  }

  const assets = chainAssets
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .map((chain) => {
      const row = byToken.get(chain.tokenId);
      const serial = row?.serial_encrypted ? decryptPII(row.serial_encrypted) : null;

      return {
        // ── authoritative, from the chain ──
        tokenId: chain.tokenId,
        orgId: chain.orgId,
        owner: chain.owner,
        assignedTo: chain.assignedTo,
        active: chain.active,
        mintedAt: chain.mintedAt,
        transferCount: chain.transferCount,
        assetHash: chain.assetHash,

        // ── display detail, from the database ──
        name: row?.name ?? `Asset #${chain.tokenId}`,
        description: row?.description ?? null,
        assetType: row?.asset_type ?? "Unknown",
        department: row?.department ?? null,
        imageUrl: row?.image_url ?? null,
        metadataUri: row?.metadata_uri ?? null,
        serialNumber: canSeeSerials ? serial : maskTail(serial),

        // ── integrity ──
        recordIntact: row ? row.asset_hash.toLowerCase() === chain.assetHash.toLowerCase() : null,
        hasOffChainRecord: Boolean(row),
      };
    });

  // Drafts that were created but never successfully minted.
  const pending = (rows ?? [])
    .filter((r) => r.token_id === null)
    .map((r) => ({
      id: r.id,
      name: r.name,
      assetType: r.asset_type,
      assetHash: r.asset_hash,
      metadataUri: r.metadata_uri,
      createdAt: r.created_at,
    }));

  return okNoStore({ orgId, count: assets.length, assets, pending });
});

// ── POST ───────────────────────────────────────────────────────────────────

const draftSchema = z.object({
  orgId: z.number().int().positive(),
  name: z.string().min(2).max(120),
  assetType: z.enum(["Laptop", "Certificate", "Software License", "Equipment", "Vehicle", "Document", "Other"]),
  description: z.string().max(1000).optional(),
  department: z.string().max(80).optional(),
  imageUrl: z.string().url().optional(),
  // Confidential — encrypted here, never written on-chain, never in metadata.
  serialNumber: z.string().max(120).optional(),
  invoiceReference: z.string().max(120).optional(),
});

/**
 * Creates the off-chain record and returns the two values the client needs to
 * call `mintAsset` from the user's own wallet:
 *
 *   assetHash   — the on-chain anchor for the confidential record
 *   metadataUri — where the public metadata JSON will be served
 *
 * The server never signs anything. Minting is the user's transaction.
 */
export const POST = handler(async (request: Request) => {
  const body = draftSchema.parse(await readJson(request));

  // Permission is re-read from the chain right now, not taken from a cookie.
  const caller = await requirePermission(body.orgId, "MINT_ASSETS");

  const assetHash = hashAssetRecord({
    orgId: body.orgId,
    name: body.name,
    assetType: body.assetType,
    serialNumber: body.serialNumber,
    invoiceReference: body.invoiceReference,
    department: body.department,
  });

  const supabase = db();
  const deployment = assetDeployment();

  const record = {
    org_id: body.orgId,
    name: body.name,
    description: body.description ?? null,
    asset_type: body.assetType,
    department: body.department ?? null,
    image_url: body.imageUrl ?? null,
    serial_encrypted: encryptPII(body.serialNumber),
    invoice_encrypted: encryptPII(body.invoiceReference),
    asset_hash: assetHash,
    metadata_uri: "pending",
    created_by: normalizeAddress(caller.wallet),
  };

  // The deployment is recorded up front so the draft cannot be confirmed against
  // a different contract than the one it was drafted for. Dropped if the
  // database has not had migration 0002 applied yet.
  let insert = await supabase
    .from("assets")
    .insert({ ...record, chain_id: deployment.chainId, contract_address: deployment.contractAddress })
    .select("id")
    .single();

  if (insert.error && isUnknownColumn(insert.error)) {
    insert = await supabase.from("assets").insert(record).select("id").single();
  }

  const { data: created, error } = insert;

  if (error || !created) throw new ApiError(500, `Could not create asset draft: ${error?.message ?? "unknown"}`);

  // The metadata URI is bound to the draft id, so it is stable before a token
  // id exists. The metadata route resolves either form.
  const metadataUri = `${serverEnv().APP_ORIGIN}/api/metadata/${created.id}`;
  await supabase.from("assets").update({ metadata_uri: metadataUri }).eq("id", created.id);

  return okNoStore({
    assetId: created.id,
    assetHash,
    metadataUri,
    // Exactly what to pass to the contract.
    mintArgs: {
      orgId: body.orgId,
      assetHash,
      metadataURI: metadataUri,
    },
    note: "Call AssetNFT.mintAsset(orgId, assignedTo, assetHash, metadataURI) from the wallet, then POST /api/assets/<assetId>/confirm",
  });
});
