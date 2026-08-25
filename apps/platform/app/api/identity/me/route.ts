import { handler, okNoStore } from "@/lib/http";
import { requireCaller } from "@/lib/authz";
import { db, normalizeAddress } from "@/lib/supabase";
import { decryptPII, maskEmail } from "@/lib/crypto";
import { readIdentity, readMemberships, readAssetsOfHolder, readPermissionsFor } from "@/lib/chain";

/**
 * GET /api/identity/me
 *
 * Everything the UI needs about the signed-in user: on-chain identity status,
 * live memberships and roles, permissions in the active org, held assets, and
 * the off-chain profile.
 *
 * The wallet comes from the session cookie. The role comes from the chain.
 */
export const GET = handler(async (request: Request) => {
  const { wallet } = await requireCaller();
  const url = new URL(request.url);
  const orgIdParam = url.searchParams.get("orgId");

  const [identity, memberships, heldAssets] = await Promise.all([
    readIdentity(wallet),
    readMemberships(wallet),
    readAssetsOfHolder(wallet).catch(() => [] as number[]),
  ]);

  const activeOrgId = orgIdParam ? Number(orgIdParam) : (memberships[0]?.orgId ?? null);

  const permissions =
    activeOrgId !== null && memberships.some((m) => m.orgId === activeOrgId)
      ? await readPermissionsFor(activeOrgId, wallet)
      : null;

  const { data: profile } = await db()
    .from("profiles")
    .select("display_name, job_title, department, avatar_url, email_encrypted, identity_hash")
    .eq("wallet_address", normalizeAddress(wallet))
    .maybeSingle();

  // The user may see their own email; it is masked anywhere else.
  const email = profile?.email_encrypted ? decryptPII(profile.email_encrypted) : null;

  return okNoStore({
    wallet,
    identity: {
      registered: identity.registered,
      active: identity.active,
      identityHash: identity.identityHash,
      registeredAt: identity.registeredAt,
      did: `did:ownex:${wallet}`,
      // Does the off-chain record still match the on-chain anchor?
      recordIntact:
        identity.identityHash && profile?.identity_hash
          ? identity.identityHash.toLowerCase() === profile.identity_hash.toLowerCase()
          : null,
    },
    profile: profile
      ? {
          displayName: profile.display_name,
          jobTitle: profile.job_title,
          department: profile.department,
          avatarUrl: profile.avatar_url,
          email,
          emailMasked: maskEmail(email),
        }
      : null,
    activeOrgId,
    memberships,
    permissions,
    assets: heldAssets,
  });
});
