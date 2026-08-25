import { sessionWallet } from "./session";
import { forbidden, unauthorized } from "./http";
import {
  readEffectiveRole,
  readHasPermission,
  readIdentity,
  type PermissionKey,
  type RoleName,
  PERMISSION_LIST,
} from "./chain";

/**
 * Authorization. Two rules, and neither is negotiable.
 *
 * 1. The caller's wallet comes ONLY from the encrypted session cookie, which
 *    was issued after a verified signature. Never from a body, query string,
 *    or header the client controls.
 *
 * 2. Roles and permissions are read from the contract at request time, not
 *    from the session. The cookie says who you are; the chain says what you
 *    may do. This is why revoking an identity locks someone out immediately
 *    rather than whenever their cookie happens to expire.
 */

export type Caller = {
  wallet: string;
};

export async function requireCaller(): Promise<Caller> {
  const wallet = await sessionWallet();
  if (!wallet) throw unauthorized();
  return { wallet };
}

/** Caller must additionally hold a live, non-revoked identity on-chain. */
export async function requireActiveIdentity(): Promise<Caller> {
  const caller = await requireCaller();
  const identity = await readIdentity(caller.wallet);

  if (!identity.registered) throw forbidden("This wallet has no registered identity");
  if (!identity.active) throw forbidden("This identity has been revoked");

  return caller;
}

/** Caller must currently hold any role in the organization. */
export async function requireMember(orgId: number): Promise<Caller & { role: RoleName }> {
  const caller = await requireActiveIdentity();
  const role = await readEffectiveRole(orgId, caller.wallet);
  if (role === "NONE") throw forbidden("You are not a member of this organization");
  return { ...caller, role };
}

/**
 * Caller must hold a specific permission, verified on-chain right now.
 * Use this on every write endpoint.
 */
export async function requirePermission(
  orgId: number,
  permission: PermissionKey
): Promise<Caller & { role: RoleName }> {
  const caller = await requireActiveIdentity();

  const entry = PERMISSION_LIST.find((p) => p.key === permission);
  if (!entry) throw forbidden("Unknown permission");

  const allowed = await readHasPermission(orgId, caller.wallet, entry.hash);
  if (!allowed) throw forbidden(`Your role cannot ${entry.label.toLowerCase()}`);

  const role = await readEffectiveRole(orgId, caller.wallet);
  return { ...caller, role };
}
