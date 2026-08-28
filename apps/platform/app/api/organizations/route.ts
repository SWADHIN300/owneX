import { z } from "zod";
import { handler, okNoStore, readJson } from "@/lib/http";
import { requireActiveIdentity } from "@/lib/authz";
import { hashOrganizationRecord } from "@/lib/hash";

/**
 * POST /api/organizations — prepare an organisation for creation
 *
 * Returns the metadata hash to pass to `createOrganization`. Deliberately writes
 * nothing: the primary key of an organisation is its on-chain id, which does not
 * exist until the transaction lands, so there is no row to insert yet. Inventing
 * a placeholder id would mean the database briefly disagreed with the chain about
 * what exists — and the chain is the one that is right.
 *
 * The caller must hold an active identity. An organisation whose root admin has
 * no identity would resolve to no admin at all, since `effectiveRole` returns
 * NONE for a revoked or absent identity.
 */

const prepareSchema = z.object({
  name: z.string().min(2).max(120),
  industry: z.string().max(80).optional(),
  website: z.string().url().optional(),
  description: z.string().max(500).optional(),
});

export const POST = handler(async (request: Request) => {
  const caller = await requireActiveIdentity();
  const body = prepareSchema.parse(await readJson(request));

  const metadataHash = hashOrganizationRecord({
    name: body.name,
    industry: body.industry,
    website: body.website,
  });

  return okNoStore({
    metadataHash,
    createArgs: { metadataHash },
    rootAdmin: caller.wallet,
    note: "Call IdentityRegistry.createOrganization(metadataHash) from the wallet, then POST /api/organizations/confirm with the orgId from the OrganizationCreated event.",
  });
});
