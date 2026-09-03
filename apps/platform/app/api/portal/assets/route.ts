import { z } from "zod";

import { handler, okNoStore, badRequest, ApiError } from "@/lib/http";
import { authenticatePartner } from "@/lib/partner-auth";
import { evaluateLiveAccess } from "@/lib/live-access";
import { readAsset, readAssetsOfOrganization } from "@/lib/chain";

/**
 * GET /api/portal/assets?wallet=0x…&orgId=1
 *
 * Assets assigned to a wallet, for a partner application to display.
 *
 * This is the one partner-facing endpoint that returns organization data rather
 * than an access decision, so it is the strictest:
 *
 *   • It requires the partner's client credentials in production, like
 *     /api/roles/verify, and an authenticated partner may only ask about its own
 *     organization.
 *   • It runs the full live access check first. A wallet whose identity was
 *     revoked, whose membership expired, or whose role lost access to the
 *     application gets an empty list — not the last data it was entitled to.
 *   • It returns token id, name-free type and active flag only. No descriptions,
 *     serial numbers, invoice references or documents: those are the private half
 *     of an asset record and belong to the owneX console, not to a partner.
 */

const querySchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  orgId: z.coerce.number().int().positive(),
});

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    wallet: url.searchParams.get("wallet"),
    orgId: url.searchParams.get("orgId"),
  });
  if (!parsed.success) throw badRequest("Provide wallet=0x… and orgId=<number>");

  const { wallet, orgId } = parsed.data;

  const auth = await authenticatePartner(request);
  if (!auth.ok) throw new ApiError(auth.status, auth.message, auth.code);

  const appSlug = auth.mode === "credentials" ? auth.application.slug : null;
  if (auth.mode === "credentials" && auth.application.orgId !== orgId) {
    throw new ApiError(
      403,
      "Your client credentials are registered to a different organization",
      "ORG_MISMATCH",
    );
  }

  const access = await evaluateLiveAccess({ orgId, wallet, appSlug });
  if (!access.ok) {
    throw new ApiError(503, "Could not verify access on-chain", "CHAIN_UNAVAILABLE");
  }
  // Fail closed: no access, no data.
  if (!access.decision.allowed) {
    return okNoStore({ assets: [], allowed: false, reason: access.decision.reason });
  }

  const ids = await readAssetsOfOrganization(orgId);
  const records = await Promise.all(ids.map(readAsset));

  const assets = records
    .filter((record): record is NonNullable<typeof record> => record !== null)
    .filter((record) => record.assignedTo.toLowerCase() === wallet.toLowerCase())
    .map((record) => ({
      tokenId: record.tokenId,
      active: record.active,
      // Deliberately no name, description, serial or invoice reference.
      assetType: "Asset",
    }));

  return okNoStore({ assets, allowed: true, reason: null });
});
