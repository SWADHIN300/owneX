import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FORBIDDEN_CLAIM_KEYS,
  PARTNER_CLAIM_KEYS,
  buildPartnerClaims,
  decideAccess,
  explainDenial,
  type AccessSnapshot,
} from "./access-decision.ts";

/** A wallet that should be allowed everything. Each test breaks one thing. */
function allowed(overrides: Partial<AccessSnapshot> = {}): AccessSnapshot {
  return {
    organization: { active: true },
    identity: { registered: true, active: true },
    membership: { expired: false },
    role: "MANAGER",
    appAccess: true,
    appRegistered: true,
    ...overrides,
  };
}

test("everything satisfied means allowed", () => {
  assert.deepEqual(decideAccess(allowed()), { allowed: true, reason: null });
});

test("an organization-only question needs no application", () => {
  const snapshot = allowed();
  delete snapshot.appAccess;
  delete snapshot.appRegistered;
  assert.deepEqual(decideAccess(snapshot), { allowed: true, reason: null });
});

test("an unregistered identity is refused", () => {
  assert.deepEqual(decideAccess(allowed({ identity: { registered: false, active: false } })), {
    allowed: false,
    reason: "IDENTITY_NOT_REGISTERED",
  });
});

test("a revoked identity is refused, and reported as revoked rather than as 'not a member'", () => {
  // On-chain a revoked identity also collapses effectiveRole to NONE. Checking the
  // identity first is what preserves the reason the partner needs to display.
  assert.deepEqual(
    decideAccess(allowed({ identity: { registered: true, active: false }, role: "NONE" })),
    { allowed: false, reason: "IDENTITY_REVOKED" },
  );
});

test("a suspended organization is refused", () => {
  assert.deepEqual(decideAccess(allowed({ organization: { active: false } })), {
    allowed: false,
    reason: "ORGANIZATION_SUSPENDED",
  });
});

test("an organization that does not exist is refused", () => {
  assert.deepEqual(decideAccess(allowed({ organization: null })), {
    allowed: false,
    reason: "ORGANIZATION_NOT_FOUND",
  });
});

test("an expired role is refused, and reported as expired rather than as 'not a member'", () => {
  assert.deepEqual(decideAccess(allowed({ membership: { expired: true }, role: "NONE" })), {
    allowed: false,
    reason: "ROLE_EXPIRED",
  });
});

test("a wallet with no role is refused", () => {
  assert.deepEqual(decideAccess(allowed({ role: "NONE" })), {
    allowed: false,
    reason: "NOT_A_MEMBER",
  });
  assert.deepEqual(decideAccess(allowed({ role: "" })), {
    allowed: false,
    reason: "NOT_A_MEMBER",
  });
});

test("a valid role with no app access is refused", () => {
  assert.deepEqual(decideAccess(allowed({ appAccess: false })), {
    allowed: false,
    reason: "APP_ACCESS_NOT_GRANTED",
  });
});

test("an application that was never registered on-chain is refused", () => {
  // The database row exists; the registerApplication transaction never landed. A
  // row is configuration, not an integration.
  assert.deepEqual(decideAccess(allowed({ appRegistered: false, appAccess: true })), {
    allowed: false,
    reason: "APPLICATION_NOT_REGISTERED",
  });
});

test("no combination of missing values produces an approval", () => {
  const breakages: Array<Partial<AccessSnapshot>> = [
    { organization: null },
    { identity: { registered: false, active: true } },
    { identity: { registered: true, active: false } },
    { organization: { active: false } },
    { membership: { expired: true } },
    { role: "NONE" },
    { appAccess: false },
    { appRegistered: false, appAccess: false },
  ];

  for (const breakage of breakages) {
    const decision = decideAccess(allowed(breakage));
    assert.equal(decision.allowed, false, JSON.stringify(breakage));
    assert.notEqual(decision.reason, null, JSON.stringify(breakage));
  }
});

test("every denial reason has an explanation", () => {
  const reasons = [
    "ORGANIZATION_NOT_FOUND",
    "ORGANIZATION_SUSPENDED",
    "IDENTITY_NOT_REGISTERED",
    "IDENTITY_REVOKED",
    "NOT_A_MEMBER",
    "ROLE_EXPIRED",
    "APP_ACCESS_NOT_GRANTED",
    "APPLICATION_NOT_REGISTERED",
  ] as const;
  for (const reason of reasons) {
    assert.ok(explainDenial(reason).length > 10, reason);
  }
});

/* -------------------------------------------------------------------------- */
/* Claims — the privacy boundary                                               */
/* -------------------------------------------------------------------------- */

test("partner claims contain exactly the six agreed keys", () => {
  const claims = buildPartnerClaims({
    wallet: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
    orgId: 1,
    role: "MANAGER",
    permissions: { VIEW_AUDIT: true, MINT_ASSETS: false },
    identityActive: true,
    verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.deepEqual(Object.keys(claims).sort(), [...PARTNER_CLAIM_KEYS].sort());
  assert.deepEqual(claims, {
    wallet: "0xabcdef0123456789abcdef0123456789abcdef01",
    orgId: 1,
    role: "MANAGER",
    permissions: { VIEW_AUDIT: true, MINT_ASSETS: false },
    identityActive: true,
    verifiedAt: "2026-01-01T00:00:00.000Z",
  });
});

test("no private profile field can reach a partner", () => {
  const claims = buildPartnerClaims({
    wallet: "0x0000000000000000000000000000000000000001",
    orgId: 7,
    role: "USER",
    permissions: { VIEW_AUDIT: false },
    identityActive: true,
  }) as unknown as Record<string, unknown>;

  for (const forbidden of FORBIDDEN_CLAIM_KEYS) {
    assert.equal(forbidden in claims, false, `${forbidden} must never be returned`);
  }

  // And the serialised form mentions none of them either, so a nested value
  // cannot smuggle one through.
  const serialised = JSON.stringify(claims).toLowerCase();
  for (const forbidden of FORBIDDEN_CLAIM_KEYS) {
    assert.equal(serialised.includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test("extra properties on the input are dropped rather than passed through", () => {
  const claims = buildPartnerClaims({
    wallet: "0x0000000000000000000000000000000000000001",
    orgId: 1,
    role: "USER",
    permissions: { VIEW_AUDIT: true },
    identityActive: true,
    // A shape that a wider upstream type might one day carry.
    ...({ email: "someone@acme.test", displayName: "Someone", phone: "+100" } as object),
  });

  const keys = Object.keys(claims);
  assert.equal(keys.includes("email"), false);
  assert.equal(keys.includes("displayName"), false);
  assert.equal(keys.includes("phone"), false);
});

test("permissions are normalised to booleans, and a missing map becomes empty", () => {
  const claims = buildPartnerClaims({
    wallet: "0x0000000000000000000000000000000000000001",
    orgId: 1,
    role: "USER",
    permissions: { VIEW_AUDIT: true, ODD: "yes" } as unknown as Record<string, boolean>,
    identityActive: true,
  });
  assert.deepEqual(claims.permissions, { VIEW_AUDIT: true });

  const empty = buildPartnerClaims({
    wallet: "0x0000000000000000000000000000000000000001",
    orgId: 1,
    role: "NONE",
    permissions: null,
    identityActive: false,
  });
  assert.deepEqual(empty.permissions, {});
  assert.equal(empty.identityActive, false);
});

test("verifiedAt is an ISO timestamp", () => {
  const claims = buildPartnerClaims({
    wallet: "0x0000000000000000000000000000000000000001",
    orgId: 1,
    role: "USER",
    permissions: {},
    identityActive: true,
  });
  assert.match(claims.verifiedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
