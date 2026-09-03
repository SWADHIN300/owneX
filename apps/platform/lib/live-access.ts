import {
  accessManager,
  appIdFromSlug,
  readCanAccessApp,
  readEffectiveRole,
  readIdentity,
  readMembership,
  readOrganization,
  readPermissionsFor,
  roleHash,
  type PermissionKey,
  type RoleName,
} from "./chain";
import { evaluateAccess, type EvaluatedAccess } from "./access-decision";
import { ASSIGNABLE_ROLES } from "./applications";

/**
 * The live authorization read, in one place.
 *
 * Four endpoints need the same answer — the consent screen, the approve action,
 * the code exchange, and the revalidation endpoint. Duplicating the reads would
 * mean four chances for one of them to drift into a more permissive shape, which
 * is precisely what the previous implementation did: the old approve route
 * defaulted `canAccess` to `true` when the RPC call threw.
 *
 * This module is only the wiring. The decision, and the guarantee that any failure
 * is a refusal, live in `lib/access-decision.ts` where they are unit tested with
 * readers that throw.
 */

export type LiveAccessSnapshot = {
  role: RoleName;
  identityRegistered: boolean;
  identityActive: boolean;
  organizationActive: boolean;
  membership: { joinedAt: number | null; expiresAt: number | null; expired: boolean };
  permissions: Record<PermissionKey, boolean> | null;
  app: { slug: string; appId: string; registered: boolean; allowed: boolean } | null;
};

export type LiveAccessResult = EvaluatedAccess;

export async function evaluateLiveAccess(params: {
  orgId: number;
  wallet: string;
  appSlug?: string | null;
}): Promise<LiveAccessResult> {
  const { orgId, wallet } = params;
  const appSlug = params.appSlug ?? null;
  const appId = appSlug ? appIdFromSlug(appSlug) : null;

  const result = await evaluateAccess({
    organization: async () => {
      const organization = await readOrganization(orgId);
      return organization ? { active: organization.active } : null;
    },
    identity: async () => {
      const identity = await readIdentity(wallet);
      return { registered: identity.registered, active: identity.active };
    },
    role: () => readEffectiveRole(orgId, wallet),
    membership: async () => {
      const membership = await readMembership(orgId, wallet);
      return {
        joinedAt: membership.joinedAt,
        expiresAt: membership.expiresAt,
        expired: membership.expired,
      };
    },
    permissions: () => readPermissionsFor(orgId, wallet),
    app: async () => {
      if (!appId || !appSlug) return null;
      const [registered, allowed] = await Promise.all([
        accessManager().applicationRegistered(orgId, appId) as Promise<boolean>,
        readCanAccessApp(orgId, wallet, appId),
      ]);
      return { slug: appSlug, appId, registered: Boolean(registered), allowed: Boolean(allowed) };
    },
  });

  if (!result.ok) {
    console.error("[ownex] live access read failed, denying:", result.detail);
  }

  return result;
}

/**
 * Which roles the chain currently lets into an application.
 *
 * Read rather than inferred from the database's `allowed_roles`, which records
 * only what an admin intended. The two can differ whenever a `setAppAccess`
 * transaction was never signed, and the dashboard has to be able to say so.
 */
export async function readRoleAccess(
  orgId: number,
  appId: string,
): Promise<Record<RoleName, boolean>> {
  const manager = accessManager();
  const entries = await Promise.all(
    ASSIGNABLE_ROLES.map(
      async (role) =>
        [role, Boolean(await manager.appAccessForRole(orgId, appId, roleHash(role)))] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<RoleName, boolean>;
}
