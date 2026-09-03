import { z } from "zod";

import { handler, okNoStore, badRequest, ApiError } from "@/lib/http";
import { authenticatePartner } from "@/lib/partner-auth";
import { evaluateLiveAccess } from "@/lib/live-access";
import { buildPartnerClaims, explainDenial } from "@/lib/access-decision";
import { RegistryUnavailableError, findApplicationBySlug } from "@/lib/applications";

/**
 * GET /api/roles/verify?wallet=0x…&orgId=1&app=<app-slug>
 *
 * LIVE REVALIDATION. A partner application calls this on every request it serves.
 * The authorization code told it who signed in; this tells it whether that is
 * still true. Nothing is cached, everything is read from the contracts, so an
 * identity revoked or a role expired a second ago is refused on the next request
 * the user makes — which is the property that makes on-chain RBAC worth having.
 *
 * SECURITY
 *   • Production requires the partner's client credentials (see lib/partner-auth).
 *     Outside production an unauthenticated call is answered, because it reveals
 *     only public chain state and that makes local integration far easier. The
 *     response says which mode answered it.
 *   • An authenticated partner may only ask about its own application and its own
 *     organization. A valid credential is not a licence to enumerate someone
 *     else's integration.
 *   • The payload carries no private profile data: no name, email, phone, job
 *     title or department. Only the wallet, organization, live role, permission
 *     flags, and the reason when access is refused.
 *   • Every failure path denies. A chain read that throws answers 503, never
 *     `allowed: true`.
 */

const querySchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "wallet must be a 0x-prefixed address"),
  orgId: z.coerce.number().int().positive(),
  app: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    .optional(),
});

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    wallet: url.searchParams.get("wallet"),
    orgId: url.searchParams.get("orgId"),
    app: url.searchParams.get("app") ?? undefined,
  });

  if (!parsed.success) {
    throw badRequest("Provide wallet=0x… and orgId=<number>, optionally app=<slug>");
  }

  const { wallet, orgId, app } = parsed.data;

  const auth = await authenticatePartner(request);
  if (!auth.ok) throw new ApiError(auth.status, auth.message, auth.code);

  if (auth.mode === "credentials") {
    const caller = auth.application;
    if (caller.orgId !== orgId) {
      throw new ApiError(
        403,
        "Your client credentials are registered to a different organization",
        "ORG_MISMATCH",
      );
    }
    if (app !== undefined && app !== caller.slug) {
      throw new ApiError(
        403,
        "Your client credentials may only verify access to their own application",
        "APP_MISMATCH",
      );
    }
  }

  // The application an unauthenticated development caller named still has to
  // exist: answering about an app nobody registered would suggest a slug is
  // enough to be part of this system.
  const appSlug = app ?? (auth.mode === "credentials" ? auth.application.slug : null);
  if (appSlug) {
    try {
      const record = await findApplicationBySlug(orgId, appSlug);
      if (!record) {
        return okNoStore({
          wallet: wallet.toLowerCase(),
          orgId,
          allowed: false,
          reason: "APPLICATION_NOT_REGISTERED",
          detail: "No application with that slug is registered for this organization.",
          role: "NONE",
          verifiedAt: new Date().toISOString(),
        });
      }
      if (record.status === "revoked") {
        return okNoStore({
          wallet: wallet.toLowerCase(),
          orgId,
          allowed: false,
          reason: "APPLICATION_REVOKED",
          detail: "An organization administrator has revoked this integration.",
          role: "NONE",
          verifiedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      if (error instanceof RegistryUnavailableError) {
        throw new ApiError(503, "Could not verify access right now", "REGISTRY_UNAVAILABLE");
      }
      throw error;
    }
  }

  const access = await evaluateLiveAccess({ orgId, wallet, appSlug });

  // Fail closed. A controlled 503 is the only alternative to a decision, and a
  // partner that receives it must keep the user out.
  if (!access.ok) {
    throw new ApiError(
      503,
      "Could not read identity and role from the blockchain. Access is denied until this succeeds.",
      "CHAIN_UNAVAILABLE",
    );
  }

  const { decision, snapshot } = access;

  const claims = buildPartnerClaims({
    wallet,
    orgId,
    role: snapshot.role,
    permissions: snapshot.permissions,
    identityActive: snapshot.identityActive,
  });

  return okNoStore({
    ...claims,
    allowed: decision.allowed,
    reason: decision.reason,
    detail: decision.reason ? explainDenial(decision.reason) : null,
    organizationActive: snapshot.organizationActive,
    membership: {
      joinedAt: snapshot.membership.joinedAt,
      expiresAt: snapshot.membership.expiresAt,
      expired: snapshot.membership.expired,
    },
    appAccess: snapshot.app
      ? { slug: snapshot.app.slug, appId: snapshot.app.appId, registered: snapshot.app.registered, allowed: snapshot.app.allowed }
      : null,
    // Which credential answered this, so a partner notices immediately if it is
    // relying on the development-only public mode.
    authMode: auth.mode,
  });
});
