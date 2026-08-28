import { z } from "zod";
import { handler, okNoStore, readJson, badRequest, forbidden, ApiError } from "@/lib/http";
import { requireActiveIdentity } from "@/lib/authz";
import { db } from "@/lib/supabase";
import { hashOrganizationRecord } from "@/lib/hash";
import { readOrganization } from "@/lib/chain";

/**
 * POST /api/organizations/confirm — bind the off-chain record to a created org
 *
 * The client's claim is not taken on trust, the same way the asset confirm route
 * does not take a token id on trust. Before writing anything the server reads the
 * organisation from the chain and checks two things:
 *
 *   the caller is its root admin  — so nobody can attach a record to somebody
 *                                   else's organisation
 *   the metadata hash matches     — so the record being stored is the one that
 *                                   was actually anchored
 *
 * Without the second check the integrity claim would be theatre: a caller could
 * anchor one record and store a different one, and every later comparison would
 * pass against the wrong document.
 */

const confirmSchema = z.object({
  orgId: z.number().int().positive(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  name: z.string().min(2).max(120),
  industry: z.string().max(80).optional(),
  website: z.string().url().optional(),
  description: z.string().max(500).optional(),
});

export const POST = handler(async (request: Request) => {
  const caller = await requireActiveIdentity();
  const body = confirmSchema.parse(await readJson(request));

  const organization = await readOrganization(body.orgId);
  if (!organization) throw badRequest(`Organisation #${body.orgId} does not exist on-chain`);

  if (organization.rootAdmin.toLowerCase() !== caller.wallet.toLowerCase()) {
    throw forbidden("You are not the root admin of that organisation");
  }

  const metadataHash = hashOrganizationRecord({
    name: body.name,
    industry: body.industry,
    website: body.website,
  });

  if (organization.metadataHash.toLowerCase() !== metadataHash.toLowerCase()) {
    throw badRequest(
      "The record does not re-hash to the anchor written on-chain — refusing to bind",
    );
  }

  const { error } = await db()
    .from("organizations")
    .upsert(
      {
        org_id: body.orgId,
        name: body.name,
        industry: body.industry ?? null,
        website: body.website ?? null,
        description: body.description ?? null,
        metadata_hash: metadataHash,
      },
      { onConflict: "org_id" },
    );

  if (error) throw new ApiError(500, `Could not save the organisation: ${error.message}`);

  return okNoStore({
    orgId: body.orgId,
    name: body.name,
    rootAdmin: organization.rootAdmin,
    metadataHash,
    txHash: body.txHash,
    verified: true,
  });
});
