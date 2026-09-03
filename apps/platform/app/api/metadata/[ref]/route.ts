import { NextResponse } from "next/server";
import { handler, notFound, badRequest } from "@/lib/http";
import { db, isUnknownColumn } from "@/lib/supabase";
import { assetDeployment, readAsset } from "@/lib/chain";

/**
 * GET /api/metadata/<ref>   where ref is a token id or a draft uuid
 *
 * Public ERC-721 metadata. Wallets and block explorers fetch this.
 *
 * ⚠ EVERYTHING RETURNED HERE IS PUBLIC AND PERMANENT-ISH. Serial numbers,
 * invoice references, holder names, and contact details are deliberately absent.
 * Only display-safe fields plus the integrity anchor are exposed.
 *
 * Mutable facts (current holder, active/revoked) are read live from the chain
 * rather than frozen into the JSON, which is what lets an asset be reassigned
 * without the metadata going stale.
 *
 * A token id is resolved only against rows belonging to the AssetNFT deployment
 * this server is configured for, because the same id on a previous deployment
 * belongs to an entirely different asset.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIELDS = "id, token_id, org_id, name, description, asset_type, department, image_url, asset_hash";

type MetadataRow = {
  id: string;
  token_id: number | null;
  org_id: number;
  name: string;
  description: string | null;
  asset_type: string;
  department: string | null;
  image_url: string | null;
  asset_hash: string;
  contract_address?: string | null;
};

async function readRowByToken(tokenId: number): Promise<MetadataRow | null> {
  const deployment = assetDeployment();

  // Ordered so a row stamped with this deployment wins over an unstamped one,
  // which is the transitional case while migration 0002 is being rolled out.
  const scoped = await db()
    .from("assets")
    .select(`${FIELDS}, contract_address`)
    .eq("token_id", tokenId)
    .or(`contract_address.is.null,contract_address.eq.${deployment.contractAddress}`)
    .order("contract_address", { ascending: false, nullsFirst: false })
    .limit(1);

  if (!scoped.error) return ((scoped.data as MetadataRow[])[0] as MetadataRow | undefined) ?? null;
  if (!isUnknownColumn(scoped.error)) return null;

  const legacy = await db().from("assets").select(FIELDS).eq("token_id", tokenId).limit(1);
  return ((legacy.data as MetadataRow[] | null)?.[0] as MetadataRow | undefined) ?? null;
}

export const GET = handler(async (_request: Request, context: { params: Promise<{ ref: string }> }) => {
  const { ref } = await context.params;

  let row: MetadataRow | null;
  if (UUID.test(ref)) {
    const { data } = await db().from("assets").select(FIELDS).eq("id", ref).maybeSingle();
    row = (data as MetadataRow | null) ?? null;
  } else {
    const tokenId = Number(ref);
    if (!Number.isInteger(tokenId) || tokenId <= 0) throw badRequest("Reference must be a token id or a draft id");
    row = await readRowByToken(tokenId);
  }

  if (!row) throw notFound("No metadata for that asset");

  // Live chain facts, when the token exists.
  const chain = row.token_id !== null ? await readAsset(Number(row.token_id)).catch(() => null) : null;

  const { data: org } = await db()
    .from("organizations")
    .select("name")
    .eq("org_id", row.org_id)
    .maybeSingle();

  const attributes: Array<{ trait_type: string; value: string | number }> = [
    { trait_type: "Asset Type", value: row.asset_type },
  ];
  if (row.department) attributes.push({ trait_type: "Department", value: row.department });
  if (org?.name) attributes.push({ trait_type: "Organization", value: org.name });
  if (chain) {
    attributes.push({ trait_type: "Status", value: chain.active ? "Active" : "Revoked" });
    attributes.push({ trait_type: "Transfers", value: chain.transferCount });
  }

  const metadata = {
    name: row.name,
    description: row.description ?? `${row.asset_type} issued by ${org?.name ?? "an organization"} on OwneX.`,
    image: row.image_url ?? null,
    external_url: row.token_id !== null ? `/asset/${row.token_id}` : null,
    attributes,
    // The integrity anchor. Re-hashing the confidential record and comparing
    // against this proves whether the record was altered.
    asset_hash: row.asset_hash,
    ownex: {
      tokenId: row.token_id !== null ? Number(row.token_id) : null,
      orgId: Number(row.org_id),
      holder: chain?.owner ?? null,
      active: chain?.active ?? null,
      schema: "ownex/asset-metadata/1",
    },
  };

  return NextResponse.json(metadata, {
    headers: {
      // Safe to cache briefly: display fields rarely change, and the mutable
      // facts a caller actually depends on are read from the chain anyway.
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
});
