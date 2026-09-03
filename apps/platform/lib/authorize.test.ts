import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUTHORIZATION_CODE_TTL_MS,
  consumeAuthorizationCode,
  createMemoryCodeStore,
  generateAuthorizationCode,
  issueAuthorizationCode,
  type GrantInput,
} from "./authorize.ts";

const GRANT: GrantInput = {
  clientId: "ownex_00000000000000000000000000000001",
  appSlug: "acme-time-tracking",
  orgId: 1,
  wallet: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
  redirectUri: "https://time.acme.com/auth/ownex/callback",
};

test("a code is random, URL-safe and long", () => {
  const a = generateAuthorizationCode();
  const b = generateAuthorizationCode();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  const many = new Set(Array.from({ length: 200 }, () => generateAuthorizationCode()));
  assert.equal(many.size, 200);
});

test("a code expires two minutes after issue", () => {
  assert.equal(AUTHORIZATION_CODE_TTL_MS, 120_000);
});

test("issuing then exchanging returns the grant exactly once", async () => {
  const store = createMemoryCodeStore();
  const now = new Date("2026-01-01T00:00:00.000Z");

  const { code, expiresAt } = await issueAuthorizationCode(GRANT, store, now);
  assert.equal(new Date(expiresAt).getTime() - now.getTime(), AUTHORIZATION_CODE_TTL_MS);

  const first = await consumeAuthorizationCode(
    { code, clientId: GRANT.clientId, redirectUri: GRANT.redirectUri, now },
    store,
  );

  assert.deepEqual(first, {
    appSlug: "acme-time-tracking",
    orgId: 1,
    // Stored lowercase so a partner keying by wallet gets one spelling.
    wallet: GRANT.wallet.toLowerCase(),
    redirectUri: GRANT.redirectUri,
  });
});

test("a replayed code is refused", async () => {
  const store = createMemoryCodeStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const { code } = await issueAuthorizationCode(GRANT, store, now);
  const query = { code, clientId: GRANT.clientId, redirectUri: GRANT.redirectUri, now };

  assert.notEqual(await consumeAuthorizationCode(query, store), null);
  assert.equal(await consumeAuthorizationCode(query, store), null, "second use must fail");
  assert.equal(await consumeAuthorizationCode(query, store), null, "and every use after");
});

test("only one of two simultaneous exchanges succeeds", async () => {
  const store = createMemoryCodeStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const { code } = await issueAuthorizationCode(GRANT, store, now);
  const query = { code, clientId: GRANT.clientId, redirectUri: GRANT.redirectUri, now };

  const results = await Promise.all([
    consumeAuthorizationCode(query, store),
    consumeAuthorizationCode(query, store),
    consumeAuthorizationCode(query, store),
  ]);

  assert.equal(results.filter((result) => result !== null).length, 1);
});

test("an expired code is refused", async () => {
  const store = createMemoryCodeStore();
  const issuedAt = new Date("2026-01-01T00:00:00.000Z");
  const { code } = await issueAuthorizationCode(GRANT, store, issuedAt);

  const justInside = new Date(issuedAt.getTime() + AUTHORIZATION_CODE_TTL_MS - 1);
  const exactlyAt = new Date(issuedAt.getTime() + AUTHORIZATION_CODE_TTL_MS);
  const query = (now: Date) => ({
    code,
    clientId: GRANT.clientId,
    redirectUri: GRANT.redirectUri,
    now,
  });

  assert.equal(await consumeAuthorizationCode(query(exactlyAt), store), null, "expiry is exclusive");

  // A fresh code, to prove the boundary the other way round.
  const store2 = createMemoryCodeStore();
  const second = await issueAuthorizationCode(GRANT, store2, issuedAt);
  assert.notEqual(
    await consumeAuthorizationCode(
      { code: second.code, clientId: GRANT.clientId, redirectUri: GRANT.redirectUri, now: justInside },
      store2,
    ),
    null,
  );
});

test("a code issued long ago is refused even on a first attempt", async () => {
  const store = createMemoryCodeStore();
  const issuedAt = new Date("2026-01-01T00:00:00.000Z");
  const { code } = await issueAuthorizationCode(GRANT, store, issuedAt);

  const later = new Date(issuedAt.getTime() + 10 * 60_000);
  assert.equal(
    await consumeAuthorizationCode(
      { code, clientId: GRANT.clientId, redirectUri: GRANT.redirectUri, now: later },
      store,
    ),
    null,
  );
});

test("a code cannot be redeemed by a different client", async () => {
  const store = createMemoryCodeStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const { code } = await issueAuthorizationCode(GRANT, store, now);

  assert.equal(
    await consumeAuthorizationCode(
      {
        code,
        clientId: "ownex_000000000000000000000000000000ff",
        redirectUri: GRANT.redirectUri,
        now,
      },
      store,
    ),
    null,
  );

  // And the failed attempt did not burn the code for its rightful owner.
  assert.notEqual(
    await consumeAuthorizationCode(
      { code, clientId: GRANT.clientId, redirectUri: GRANT.redirectUri, now },
      store,
    ),
    null,
  );
});

test("a code cannot be redeemed against a different redirect_uri", async () => {
  const store = createMemoryCodeStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const { code } = await issueAuthorizationCode(GRANT, store, now);

  assert.equal(
    await consumeAuthorizationCode(
      {
        code,
        clientId: GRANT.clientId,
        redirectUri: "https://time.acme.com/auth/ownex/other",
        now,
      },
      store,
    ),
    null,
  );
});

test("an unknown code is refused without revealing anything", async () => {
  const store = createMemoryCodeStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  await issueAuthorizationCode(GRANT, store, now);

  assert.equal(
    await consumeAuthorizationCode(
      {
        code: generateAuthorizationCode(),
        clientId: GRANT.clientId,
        redirectUri: GRANT.redirectUri,
        now,
      },
      store,
    ),
    null,
  );
});

test("a code too short to be one of ours is refused without a lookup", async () => {
  const store = createMemoryCodeStore();
  let touched = false;
  const spy = {
    ...store,
    consume: async (...args: Parameters<typeof store.consume>) => {
      touched = true;
      return store.consume(...args);
    },
  };

  assert.equal(
    await consumeAuthorizationCode(
      { code: "short", clientId: GRANT.clientId, redirectUri: GRANT.redirectUri },
      spy,
    ),
    null,
  );
  assert.equal(touched, false);
});

test("a store failure propagates instead of being read as 'invalid code'", async () => {
  // The route turns this into 503. Swallowing it into null would make an outage
  // indistinguishable from a rejected code, and an attacker could not tell either
  // — but neither could the operator.
  const failing = {
    insert: async () => {},
    consume: async () => {
      throw new Error("connection reset");
    },
  };

  await assert.rejects(
    consumeAuthorizationCode(
      {
        code: generateAuthorizationCode(),
        clientId: GRANT.clientId,
        redirectUri: GRANT.redirectUri,
      },
      failing,
    ),
    /connection reset/,
  );
});
