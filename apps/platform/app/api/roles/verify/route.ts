import { z } from "zod";
import { handler, okNoStore, badRequest } from "@/lib/http";
import { db } from "@/lib/supabase";
import {
  readEffectiveRole,
  readIdentity,
  readMembership,
  readOrganization,
  readPermissionsFor,
  readCanAccessApp,
  appIdFromSlug,
} from "@/lib/chain";

/**
 * GET /api/roles/verify?wallet=0x…&orgId=1&app=employee-portal
 *
 * THE INTEGRATION ENDPOINT. This is what makes OwneX an identity provider
 * rather than just a dashboard: a Web2 application with no blockchain code of
 * its own calls this to learn who a user is and what they may do.
 *
 * Deliberately public and read-only — it exposes nothing that is not already
 * public on-chain, and no personal data. Every value is read live from the
 * contracts, so a revoked identity or an expired role is reflected instantly.
 *
 * The calling application is responsible for its own session; this endpoint
 * only answers the authorization question.
 */

const querySchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  orgId: z.coerce.number().int().positive(),
  app: z.string().min(1).optional(),
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

  const organization = await readOrganization(orgId);
  if (!organization) {
    return okNoStore({
      wallet,
      orgId,
      allowed: false,
      reason: "ORGANIZATION_NOT_FOUND",
      role: "NONE",
    });
  }

  const [identity, role, membership] = await Promise.all([
    readIdentity(wallet),
    readEffectiveRole(orgId, wallet),
    readMembership(orgId, wallet),
  ]);

  // Work out precisely why access is refused — useful for the partner app's UI.
  let reason: string | null = null;
  if (!identity.registered) reason = "IDENTITY_NOT_REGISTERED";
  else if (!identity.active) reason = "IDENTITY_REVOKED";
  else if (!organization.active) reason = "ORGANIZATION_SUSPENDED";
  else if (membership.expired) reason = "ROLE_EXPIRED";
  else if (role === "NONE") reason = "NOT_A_MEMBER";

  const permissions = role === "NONE" ? null : await readPermissionsFor(orgId, wallet);

  let appAccess: { slug: string; appId: string; allowed: boolean } | null = null;
  if (app) {
    const appId = appIdFromSlug(app);
    appAccess = { slug: app, appId, allowed: await readCanAccessApp(orgId, wallet, appId) };
    if (reason === null && !appAccess.allowed) reason = "APP_ACCESS_NOT_GRANTED";
  }

  // Display name only — never contact details or any encrypted field.
  // Deliberately non-fatal: the authorization answer comes from the chain, so a
  // database hiccup must not turn a valid "allowed" into a 500.
  const profile = await db()
    .from("profiles")
    .select("display_name, job_title, department")
    .eq("wallet_address", wallet.toLowerCase())
    .maybeSingle()
    .then((r) => r.data)
    .catch(() => null);

  const allowed = reason === null;

  return okNoStore({
    wallet,
    orgId,
    allowed,
    reason,
    role,
    identityActive: identity.active,
    organizationActive: organization.active,
    isRootAdmin: organization.rootAdmin.toLowerCase() === wallet.toLowerCase(),
    membership: {
      joinedAt: membership.joinedAt,
      expiresAt: membership.expiresAt,
      expired: membership.expired,
    },
    permissions,
    appAccess,
    displayName: profile?.display_name ?? null,
    jobTitle: profile?.job_title ?? null,
    department: profile?.department ?? null,
    verifiedAt: new Date().toISOString(),
  });
});
