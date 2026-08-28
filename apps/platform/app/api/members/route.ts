import { z } from "zod";
import { handler, okNoStore, badRequest } from "@/lib/http";
import { requireMember } from "@/lib/authz";
import { db } from "@/lib/supabase";
import { readAssetsOfHolder, readIdentity, readOrgMembers, readOrganization } from "@/lib/chain";

/**
 * GET /api/members?orgId=1 — the organisation's roster
 *
 * Any member may see who else is in their organisation; that is not a secret
 * inside a company. What is gated is the off-chain detail: display names, job
 * titles and departments are only returned to ADMIN and MANAGER, so a plain
 * USER sees the roster as wallets and roles and nothing more. The same split the
 * asset listing uses for serial numbers.
 *
 * Roles come from the chain on every request. Nothing here is cached, and the
 * expiry is reported as the contract holds it so a lapsed contractor is visibly
 * lapsed rather than quietly absent.
 */

const querySchema = z.object({
  orgId: z.coerce.number().int().positive(),
});

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) throw badRequest("orgId is required and must be a positive integer");

  const { orgId } = parsed.data;

  const caller = await requireMember(orgId);
  const canSeeProfiles = caller.role === "ADMIN" || caller.role === "MANAGER";

  const [members, organization] = await Promise.all([
    readOrgMembers(orgId),
    readOrganization(orgId),
  ]);

  // One round trip for every profile rather than one per member.
  const wallets = members.map((m) => m.wallet.toLowerCase());
  const [{ data: profiles }, { data: orgRow }] = await Promise.all([
    db()
      .from("profiles")
      .select("wallet_address, display_name, job_title, department")
      .in("wallet_address", wallets),
    db().from("organizations").select("name").eq("org_id", orgId).maybeSingle(),
  ]);

  const byWallet = new Map(
    (profiles ?? []).map((row) => [String(row.wallet_address).toLowerCase(), row]),
  );

  const enriched = await Promise.all(
    members.map(async (member) => {
      const [identity, assets] = await Promise.all([
        readIdentity(member.wallet),
        readAssetsOfHolder(member.wallet).catch(() => [] as number[]),
      ]);
      const profile = byWallet.get(member.wallet.toLowerCase());

      return {
        wallet: member.wallet,
        role: member.role,
        storedRole: member.storedRole,
        joinedAt: member.joinedAt,
        expiresAt: member.expiresAt,
        expired: member.expired,
        isRootAdmin: member.isRootAdmin,
        identity: { registered: identity.registered, active: identity.active },
        profile:
          canSeeProfiles && profile
            ? {
                displayName: profile.display_name,
                jobTitle: profile.job_title,
                department: profile.department,
              }
            : null,
        // Held certificates are a fact about the wallet, not about the profile,
        // so this is not gated.
        assetCount: assets.length,
      };
    }),
  );

  return okNoStore({
    orgId,
    organisation: organization
      ? {
          name: orgRow?.name ?? null,
          rootAdmin: organization.rootAdmin,
          active: organization.active,
        }
      : null,
    count: enriched.length,
    canSeeProfiles,
    members: enriched,
  });
});
