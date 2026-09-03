import assert from "node:assert/strict";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { test } from "node:test";

import {
  buildCallbackRedirect,
  checkCallback,
  validateCallbackList,
} from "./callback-allowlist.ts";
import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  verifyClientSecret,
} from "./client-credentials.ts";
import {
  consumeAuthorizationCode,
  createMemoryCodeStore,
  issueAuthorizationCode,
} from "./authorize.ts";
import {
  buildPartnerClaims,
  evaluateAccess,
  FORBIDDEN_CLAIM_KEYS,
  type AccessReaders,
} from "./access-decision.ts";
import { integrationStage } from "./integration.ts";

/**
 * The whole "Sign in with OwneX" flow, composed from the real modules with the
 * chain and the database replaced by fakes.
 *
 * The unit tests beside this one pin each rule in isolation. This file pins the
 * rules that only exist in the *composition*: that a code issued for one
 * application cannot be redeemed by another, that a revocation between consent and
 * exchange denies, that a chain outage denies, and that `state` survives the round
 * trip unchanged.
 */

/* -------------------------------------------------------------------------- */
/* Fakes                                                                       */
/* -------------------------------------------------------------------------- */

/** What an admin registered, as `resolveAuthorizationRequest` would return it. */
function registerApplication(overrides: Partial<FakeApp> = {}): FakeApp {
  const clientSecret = generateClientSecret();
  return {
    slug: "acme-time-tracking",
    orgId: 1,
    name: "Acme Time Tracking",
    status: "active",
    clientId: generateClientId(),
    clientSecret,
    clientSecretHash: hashClientSecret(clientSecret),
    callbacks: ["https://time.acme.com/auth/ownex/callback"],
    ...overrides,
  };
}

type FakeApp = {
  slug: string;
  orgId: number;
  name: string;
  status: string;
  clientId: string;
  /** Only the test knows this; the "database" holds the hash. */
  clientSecret: string;
  clientSecretHash: string;
  callbacks: string[];
};

type ChainState = {
  identityRegistered: boolean;
  identityActive: boolean;
  organizationActive: boolean;
  membershipExpired: boolean;
  role: string;
  appRegistered: boolean;
  appAllowed: boolean;
  /** When set, every read throws — an RPC outage. */
  fail?: string;
};

function chain(state: Partial<ChainState> = {}): { state: ChainState; readers: AccessReaders } {
  const current: ChainState = {
    identityRegistered: true,
    identityActive: true,
    organizationActive: true,
    membershipExpired: false,
    role: "MANAGER",
    appRegistered: true,
    appAllowed: true,
    ...state,
  };

  const guard = <T>(value: T): Promise<T> =>
    current.fail ? Promise.reject(new Error(current.fail)) : Promise.resolve(value);

  return {
    state: current,
    readers: {
      organization: () => guard({ active: current.organizationActive }),
      identity: () =>
        guard({ registered: current.identityRegistered, active: current.identityActive }),
      role: () => guard(current.role),
      membership: () => guard({ joinedAt: 1_700_000_000, expiresAt: null, expired: current.membershipExpired }),
      permissions: () => guard({ VIEW_AUDIT: true, MINT_ASSETS: false }),
      app: () =>
        guard({
          slug: "acme-time-tracking",
          appId: "0xappid",
          registered: current.appRegistered,
          allowed: current.appAllowed,
        }),
    },
  };
}

/** The partner's side of `state`: generate, remember, compare in constant time. */
function partnerState() {
  const value = randomBytes(32).toString("base64url");
  return {
    value,
    matches(received: string): boolean {
      const a = Buffer.from(received);
      const b = Buffer.from(value);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}

const WALLET = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";

/* -------------------------------------------------------------------------- */
/* The happy path                                                              */
/* -------------------------------------------------------------------------- */

test("a registered application completes the whole flow and receives minimal claims", async () => {
  const app = registerApplication();
  const store = createMemoryCodeStore();
  const { readers } = chain();
  const state = partnerState();
  const now = new Date("2026-01-01T00:00:00.000Z");

  // Registration-time validation accepted the callback in the first place.
  assert.deepEqual(validateCallbackList(app.callbacks, "production"), []);

  // 1. /authorize resolves the request.
  const callback = checkCallback({
    application: app,
    uri: "https://time.acme.com/auth/ownex/callback",
    mode: "production",
  });
  assert.equal(callback.ok, true);
  if (!callback.ok) return;

  // 2. Live chain state permits it.
  const access = await evaluateAccess(readers);
  assert.equal(access.ok, true);
  if (!access.ok) return;
  assert.deepEqual(access.decision, { allowed: true, reason: null });

  // 3. A code is issued, bound to the registered callback.
  const { code } = await issueAuthorizationCode(
    {
      clientId: app.clientId,
      appSlug: app.slug,
      orgId: app.orgId,
      wallet: WALLET,
      redirectUri: callback.registered,
    },
    store,
    now,
  );

  // 4. The browser is redirected to the REGISTERED callback with code and state.
  const redirect = buildCallbackRedirect(callback.registered, { code, state: state.value });
  assert.equal(redirect.origin, "https://time.acme.com");

  // 5. The partner checks state, then exchanges from its backend.
  const received = redirect.searchParams.get("state") ?? "";
  assert.equal(state.matches(received), true, "state must survive the round trip");

  assert.equal(verifyClientSecret(app.clientSecret, app.clientSecretHash), true);
  const grant = await consumeAuthorizationCode(
    {
      code: redirect.searchParams.get("code") ?? "",
      clientId: app.clientId,
      redirectUri: callback.registered,
      now,
    },
    store,
  );
  assert.notEqual(grant, null);
  if (!grant) return;

  // 6. Claims are read live at exchange time, not carried in the code.
  const fresh = await evaluateAccess(readers);
  assert.equal(fresh.ok && fresh.decision.allowed, true);
  if (!fresh.ok) return;

  const claims = buildPartnerClaims({
    wallet: grant.wallet,
    orgId: grant.orgId,
    role: fresh.snapshot.role,
    permissions: fresh.snapshot.permissions,
    identityActive: fresh.snapshot.identityActive,
    verifiedAt: now,
  });

  assert.deepEqual(claims, {
    wallet: WALLET.toLowerCase(),
    orgId: 1,
    role: "MANAGER",
    permissions: { VIEW_AUDIT: true, MINT_ASSETS: false },
    identityActive: true,
    verifiedAt: "2026-01-01T00:00:00.000Z",
  });

  const serialised = JSON.stringify(claims).toLowerCase();
  for (const forbidden of FORBIDDEN_CLAIM_KEYS) {
    assert.equal(serialised.includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test("a fully wired integration reports itself Active", () => {
  assert.equal(
    integrationStage({
      registeredOnChain: true,
      callbackCount: 1,
      hasClientSecret: true,
      rolesAllowedOnChain: 1,
      status: "active",
    }),
    "active",
  );
});

/* -------------------------------------------------------------------------- */
/* Cross-application attacks                                                   */
/* -------------------------------------------------------------------------- */

test("a code obtained by one application cannot be redeemed by another", async () => {
  const victim = registerApplication();
  const attacker = registerApplication({
    slug: "attacker-app",
    clientId: generateClientId(),
    callbacks: ["https://attacker.test/cb"],
  });
  const store = createMemoryCodeStore();
  const now = new Date("2026-01-01T00:00:00.000Z");

  const { code } = await issueAuthorizationCode(
    {
      clientId: victim.clientId,
      appSlug: victim.slug,
      orgId: victim.orgId,
      wallet: WALLET,
      redirectUri: victim.callbacks[0],
    },
    store,
    now,
  );

  // Its own client id, its own callback: nothing matches.
  assert.equal(
    await consumeAuthorizationCode(
      { code, clientId: attacker.clientId, redirectUri: attacker.callbacks[0], now },
      store,
    ),
    null,
  );

  // The victim's callback with the attacker's client id: still nothing.
  assert.equal(
    await consumeAuthorizationCode(
      { code, clientId: attacker.clientId, redirectUri: victim.callbacks[0], now },
      store,
    ),
    null,
  );

  // And the code is still usable by its rightful owner.
  assert.notEqual(
    await consumeAuthorizationCode(
      { code, clientId: victim.clientId, redirectUri: victim.callbacks[0], now },
      store,
    ),
    null,
  );
});

test("an attacker's own secret does not authenticate the victim's client id", () => {
  const victim = registerApplication();
  const attacker = registerApplication({ clientId: generateClientId() });
  assert.equal(verifyClientSecret(attacker.clientSecret, victim.clientSecretHash), false);
});

test("a redirect_uri the attacker controls is refused for a registered client", () => {
  const app = registerApplication();
  assert.deepEqual(
    checkCallback({ application: app, uri: "https://attacker.test/cb", mode: "production" }),
    { ok: false, reason: "CALLBACK_NOT_REGISTERED" },
  );
});

test("a request with an unknown client_id never reaches a callback at all", () => {
  // `resolveAuthorizationRequest` returns UNKNOWN_CLIENT before any redirect is
  // constructed, which is what stops the identity provider being an open redirect.
  assert.deepEqual(
    checkCallback({ application: null, uri: "https://attacker.test/cb", mode: "production" }),
    { ok: false, reason: "UNKNOWN_APP" },
  );
});

/* -------------------------------------------------------------------------- */
/* Revocation between consent and exchange                                     */
/* -------------------------------------------------------------------------- */

test("an identity revoked after consent cannot complete the exchange", async () => {
  const app = registerApplication();
  const store = createMemoryCodeStore();
  const { state, readers } = chain();
  const now = new Date("2026-01-01T00:00:00.000Z");

  // Consent succeeded while the identity was active.
  const before = await evaluateAccess(readers);
  assert.equal(before.ok && before.decision.allowed, true);

  const { code } = await issueAuthorizationCode(
    {
      clientId: app.clientId,
      appSlug: app.slug,
      orgId: app.orgId,
      wallet: WALLET,
      redirectUri: app.callbacks[0],
    },
    store,
    now,
  );

  // An admin revokes the identity in the seconds before the exchange.
  state.identityActive = false;
  state.role = "NONE";

  // The code itself is still valid — it is a pointer to a wallet, not a claim.
  const grant = await consumeAuthorizationCode(
    { code, clientId: app.clientId, redirectUri: app.callbacks[0], now },
    store,
  );
  assert.notEqual(grant, null);

  // But the claims are read live, and now deny.
  const after = await evaluateAccess(readers);
  assert.equal(after.ok, true);
  assert.equal(after.ok && after.decision.allowed, false);
  assert.equal(after.ok && after.decision.reason, "IDENTITY_REVOKED");
});

test("app access withdrawn after consent denies at exchange", async () => {
  const { state, readers } = chain();
  assert.equal((await evaluateAccess(readers)).ok, true);

  state.appAllowed = false;

  const after = await evaluateAccess(readers);
  assert.equal(after.ok && after.decision.allowed, false);
  assert.equal(after.ok && after.decision.reason, "APP_ACCESS_NOT_GRANTED");
});

test("a role that expires after consent denies at exchange", async () => {
  const { state, readers } = chain();
  state.membershipExpired = true;
  state.role = "NONE";

  const after = await evaluateAccess(readers);
  assert.equal(after.ok && after.decision.allowed, false);
  assert.equal(after.ok && after.decision.reason, "ROLE_EXPIRED");
});

test("a revoked integration is refused before anything else is considered", () => {
  const app = registerApplication({ status: "revoked" });
  assert.deepEqual(
    checkCallback({ application: app, uri: app.callbacks[0], mode: "production" }),
    { ok: false, reason: "APPLICATION_REVOKED" },
  );
});

/* -------------------------------------------------------------------------- */
/* Fail closed                                                                 */
/* -------------------------------------------------------------------------- */

test("an RPC failure denies rather than defaulting to allowed", async () => {
  const { readers } = chain({ fail: "could not detect network" });
  const result = await evaluateAccess(readers);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "CHAIN_UNAVAILABLE");
  // The shape has no `decision` at all, so there is nothing a caller could
  // mistakenly read as an approval.
  assert.equal("decision" in result, false);
});

test("a failure in any single read is enough to deny", async () => {
  const failures: Array<keyof AccessReaders> = [
    "organization",
    "identity",
    "role",
    "membership",
    "permissions",
    "app",
  ];

  for (const failing of failures) {
    const { readers } = chain();
    const broken: AccessReaders = {
      ...readers,
      [failing]: async () => {
        throw new Error(`${failing} unavailable`);
      },
    };

    const result = await evaluateAccess(broken);
    assert.equal(result.ok, false, `${failing} must fail closed`);
  }
});

test("a store outage during exchange surfaces as an error, not as a rejection", async () => {
  const app = registerApplication();
  const failing = {
    insert: async () => {},
    consume: async () => {
      throw new Error("connection reset");
    },
  };

  await assert.rejects(
    consumeAuthorizationCode(
      { code: "x".repeat(43), clientId: app.clientId, redirectUri: app.callbacks[0] },
      failing,
    ),
    /connection reset/,
  );
});

/* -------------------------------------------------------------------------- */
/* CSRF                                                                       */
/* -------------------------------------------------------------------------- */

test("a callback carrying a state the partner never issued is rejected", () => {
  const state = partnerState();
  const forged = buildCallbackRedirect("https://time.acme.com/auth/ownex/callback", {
    code: "attacker-code",
    state: randomBytes(32).toString("base64url"),
  });

  assert.equal(state.matches(forged.searchParams.get("state") ?? ""), false);
});

test("state is compared by length first, so a truncated value cannot match", () => {
  const state = partnerState();
  assert.equal(state.matches(state.value.slice(0, -1)), false);
  assert.equal(state.matches(""), false);
  assert.equal(state.matches(`${state.value}x`), false);
  assert.equal(state.matches(state.value), true);
});

test("a denial still carries the state, so the partner can tie it to its request", () => {
  const state = partnerState();
  const url = buildCallbackRedirect("https://time.acme.com/auth/ownex/callback", {
    error: "access_denied",
    state: state.value,
  });
  assert.equal(state.matches(url.searchParams.get("state") ?? ""), true);
  assert.equal(url.searchParams.get("code"), null);
});
