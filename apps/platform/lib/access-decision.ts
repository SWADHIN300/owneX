/**
 * The access decision, and the claims a partner application is allowed to see.
 *
 * Pure functions on purpose. Reading the chain is I/O and belongs in the route;
 * deciding what those readings *mean* is a security rule, and a security rule
 * that cannot be unit tested is a security rule nobody can trust.
 *
 * Two properties are enforced here rather than at each call site:
 *
 *   FAIL CLOSED   `decideAccess` has no path that returns `allowed: true`
 *                 without every condition being explicitly satisfied. A missing
 *                 or unreadable value is a denial, never a default.
 *
 *   MINIMAL CLAIMS `buildPartnerClaims` constructs its result from a fixed set
 *                 of keys instead of spreading a wider object. A private field
 *                 cannot leak to a partner by being added to some upstream type
 *                 later, because it would have to be written into this function
 *                 to appear at all.
 */

export type AccessDenyReason =
  | "ORGANIZATION_NOT_FOUND"
  | "ORGANIZATION_SUSPENDED"
  | "IDENTITY_NOT_REGISTERED"
  | "IDENTITY_REVOKED"
  | "NOT_A_MEMBER"
  | "ROLE_EXPIRED"
  | "APP_ACCESS_NOT_GRANTED"
  | "APPLICATION_NOT_REGISTERED";

/** Everything read live from the contracts, and nothing else. */
export type AccessSnapshot = {
  organization: { active: boolean } | null;
  identity: { registered: boolean; active: boolean };
  membership: { expired: boolean };
  /** Effective role right now: "NONE" when revoked, expired, or never a member. */
  role: string;
  /**
   * `canAccessApp` for the requested application, or null when the caller asked
   * about the organization only. A requested application that is not registered
   * on-chain must be passed as `appRegistered: false`.
   */
  appAccess?: boolean | null;
  appRegistered?: boolean | null;
};

export type AccessDecision = {
  allowed: boolean;
  reason: AccessDenyReason | null;
};

/**
 * The order of these checks is the order the reasons are useful in. A revoked
 * identity and an expired role both collapse to `effectiveRole === "NONE"`
 * on-chain, so testing "NONE" first would report every denial as NOT_A_MEMBER and
 * throw away the reason the partner needs to show the user.
 */
export function decideAccess(snapshot: AccessSnapshot): AccessDecision {
  const deny = (reason: AccessDenyReason): AccessDecision => ({ allowed: false, reason });

  if (!snapshot.organization) return deny("ORGANIZATION_NOT_FOUND");
  if (!snapshot.identity?.registered) return deny("IDENTITY_NOT_REGISTERED");
  if (!snapshot.identity.active) return deny("IDENTITY_REVOKED");
  if (!snapshot.organization.active) return deny("ORGANIZATION_SUSPENDED");
  if (snapshot.membership?.expired) return deny("ROLE_EXPIRED");
  if (!snapshot.role || snapshot.role === "NONE") return deny("NOT_A_MEMBER");

  // An application was named in the request.
  if (snapshot.appAccess !== undefined && snapshot.appAccess !== null) {
    if (snapshot.appRegistered === false) return deny("APPLICATION_NOT_REGISTERED");
    if (!snapshot.appAccess) return deny("APP_ACCESS_NOT_GRANTED");
  } else if (snapshot.appAccess === null && snapshot.appRegistered === false) {
    return deny("APPLICATION_NOT_REGISTERED");
  }

  return { allowed: true, reason: null };
}

export function explainDenial(reason: AccessDenyReason): string {
  switch (reason) {
    case "ORGANIZATION_NOT_FOUND":
      return "That organization does not exist on-chain.";
    case "ORGANIZATION_SUSPENDED":
      return "This organization is currently suspended.";
    case "IDENTITY_NOT_REGISTERED":
      return "This wallet has no registered owneX identity.";
    case "IDENTITY_REVOKED":
      return "This identity has been revoked.";
    case "NOT_A_MEMBER":
      return "This wallet is not a member of the organization.";
    case "ROLE_EXPIRED":
      return "The membership behind this role has expired.";
    case "APP_ACCESS_NOT_GRANTED":
      return "This role has not been granted access to the application on-chain.";
    case "APPLICATION_NOT_REGISTERED":
      return "The application is not registered on-chain for this organization.";
  }
}

/* -------------------------------------------------------------------------- */
/* Fail-closed evaluation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The live reads an access decision needs, as injectable functions.
 *
 * Taking them as parameters rather than importing the chain module is what makes
 * the fail-closed guarantee testable: a test can hand in a reader that throws and
 * assert that the answer is a refusal. The real readers are wired up in
 * `lib/live-access.ts`.
 */
export type AccessReaders = {
  organization: () => Promise<{ active: boolean } | null>;
  identity: () => Promise<{ registered: boolean; active: boolean }>;
  role: () => Promise<string>;
  membership: () => Promise<{
    joinedAt: number | null;
    expiresAt: number | null;
    expired: boolean;
  }>;
  /** Only called when the wallet holds a role; six contract calls otherwise wasted. */
  permissions: (role: string) => Promise<Record<string, boolean> | null>;
  /** Null when the request named no application. */
  app: () => Promise<{
    slug: string;
    appId: string;
    registered: boolean;
    allowed: boolean;
  } | null>;
};

export type EvaluatedSnapshot = {
  role: string;
  identityRegistered: boolean;
  identityActive: boolean;
  organizationActive: boolean;
  membership: { joinedAt: number | null; expiresAt: number | null; expired: boolean };
  permissions: Record<string, boolean> | null;
  app: { slug: string; appId: string; registered: boolean; allowed: boolean } | null;
};

export type EvaluatedAccess =
  | { ok: true; decision: AccessDecision; snapshot: EvaluatedSnapshot }
  | { ok: false; error: "CHAIN_UNAVAILABLE"; detail: string };

/**
 * Read everything, then decide.
 *
 * ANY failure returns `{ ok: false }`. There is no partial success: a read that
 * throws leaves the caller unable to prove the user's access, and "unable to
 * prove" must mean "refuse". The previous implementation of the approve endpoint
 * did the opposite — it caught the error and set `canAccess = true` — which meant
 * an RPC outage silently granted access to everybody who asked.
 */
export async function evaluateAccess(readers: AccessReaders): Promise<EvaluatedAccess> {
  try {
    const [organization, identity, role, membership, app] = await Promise.all([
      readers.organization(),
      readers.identity(),
      readers.role(),
      readers.membership(),
      readers.app(),
    ]);

    const permissions = role === "NONE" ? null : await readers.permissions(role);

    const decision = decideAccess({
      organization: organization ? { active: organization.active } : null,
      identity: { registered: identity.registered, active: identity.active },
      membership: { expired: membership.expired },
      role,
      appAccess: app ? app.allowed : undefined,
      appRegistered: app ? app.registered : undefined,
    });

    return {
      ok: true,
      decision,
      snapshot: {
        role,
        identityRegistered: identity.registered,
        identityActive: identity.active,
        organizationActive: Boolean(organization?.active),
        membership,
        permissions,
        app,
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown chain error";
    return { ok: false, error: "CHAIN_UNAVAILABLE", detail };
  }
}

/* -------------------------------------------------------------------------- */
/* Claims                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Exactly what a partner application receives. Nothing else.
 *
 * Deliberately absent: email, phone, display name, job title, department, avatar,
 * asset descriptions, serial numbers, invoice references, documents, and the
 * organization's private metadata. A partner learns a public wallet address, the
 * organization it is asking about, the role the chain says applies right now, and
 * the permission booleans that follow from that role.
 */
export type PartnerClaims = {
  wallet: string;
  orgId: number;
  role: string;
  permissions: Record<string, boolean>;
  identityActive: boolean;
  verifiedAt: string;
};

/** The complete, closed set of keys a partner response may contain. */
export const PARTNER_CLAIM_KEYS = [
  "wallet",
  "orgId",
  "role",
  "permissions",
  "identityActive",
  "verifiedAt",
] as const;

/**
 * Fields that must never appear in a partner-facing payload. Used by the tests
 * as an executable statement of the privacy boundary.
 */
export const FORBIDDEN_CLAIM_KEYS = [
  "email",
  "emailEncrypted",
  "email_encrypted",
  "emailMasked",
  "phone",
  "phoneEncrypted",
  "phone_encrypted",
  "displayName",
  "display_name",
  "jobTitle",
  "job_title",
  "department",
  "avatarUrl",
  "avatar_url",
  "identityHash",
  "serialNumber",
  "serial_encrypted",
  "invoiceReference",
  "invoice_encrypted",
  "privateKey",
  "mnemonic",
  "seedPhrase",
  "clientSecret",
  "client_secret",
  "clientSecretHash",
  "client_secret_hash",
] as const;

export function buildPartnerClaims(input: {
  wallet: string;
  orgId: number;
  role: string;
  permissions: Record<string, boolean> | null | undefined;
  identityActive: boolean;
  verifiedAt?: Date;
}): PartnerClaims {
  return {
    // Lowercased so a partner keying its own records by wallet gets one
    // spelling, not a checksummed and a non-checksummed variant.
    wallet: input.wallet.toLowerCase(),
    orgId: input.orgId,
    role: input.role,
    permissions: normalizePermissions(input.permissions),
    identityActive: Boolean(input.identityActive),
    verifiedAt: (input.verifiedAt ?? new Date()).toISOString(),
  };
}

/** Booleans only, and only for keys whose value is a boolean. */
function normalizePermissions(
  permissions: Record<string, boolean> | null | undefined,
): Record<string, boolean> {
  if (!permissions) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(permissions)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}
