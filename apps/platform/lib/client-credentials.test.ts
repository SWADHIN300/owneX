import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLIENT_ID_PREFIX,
  CLIENT_SECRET_PREFIX,
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  isProduction,
  verifyClientSecret,
} from "./client-credentials.ts";

test("a client id is prefixed and unguessable", () => {
  const a = generateClientId();
  const b = generateClientId();
  assert.match(a, /^ownex_[0-9a-f]{32}$/);
  assert.ok(a.startsWith(CLIENT_ID_PREFIX));
  assert.notEqual(a, b);
});

test("a client secret carries at least 256 bits of entropy", () => {
  const secret = generateClientSecret();
  assert.ok(secret.startsWith(CLIENT_SECRET_PREFIX));
  // 32 bytes base64url is 43 characters, plus the prefix.
  assert.ok(secret.length >= CLIENT_SECRET_PREFIX.length + 43, secret);
  const many = new Set(Array.from({ length: 50 }, () => generateClientSecret()));
  assert.equal(many.size, 50);
});

test("the stored hash never contains the secret", () => {
  const secret = generateClientSecret();
  const stored = hashClientSecret(secret);
  assert.ok(!stored.includes(secret));
  // Nor the body of it without the prefix.
  assert.ok(!stored.includes(secret.slice(CLIENT_SECRET_PREFIX.length)));
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
});

test("the same secret hashes differently each time, and both verify", () => {
  const secret = generateClientSecret();
  const first = hashClientSecret(secret);
  const second = hashClientSecret(secret);
  assert.notEqual(first, second, "a per-hash salt must be used");
  assert.equal(verifyClientSecret(secret, first), true);
  assert.equal(verifyClientSecret(secret, second), true);
});

test("a wrong secret is rejected", () => {
  const stored = hashClientSecret(generateClientSecret());
  assert.equal(verifyClientSecret(generateClientSecret(), stored), false);
});

test("a near-miss secret is rejected", () => {
  const secret = generateClientSecret();
  const stored = hashClientSecret(secret);
  assert.equal(verifyClientSecret(`${secret}x`, stored), false);
  assert.equal(verifyClientSecret(secret.slice(0, -1), stored), false);
  assert.equal(verifyClientSecret(secret.toUpperCase(), stored), false);
});

test("verification fails closed for every degenerate stored value", () => {
  const secret = generateClientSecret();
  for (const stored of [
    null,
    undefined,
    "",
    "not-a-hash",
    "scrypt$16384$8$1$onlyfourparts",
    "scrypt$16384$8$1$c2FsdA$", // empty digest
    "argon2$16384$8$1$c2FsdA$ZGlnZXN0",
    "scrypt$abc$8$1$c2FsdA$ZGlnZXN0", // non-numeric cost
    "scrypt$16$8$1$c2FsdA$ZGlnZXN0", // cost far below the floor
  ]) {
    assert.equal(
      verifyClientSecret(secret, stored as string | null | undefined),
      false,
      String(stored),
    );
  }
});

test("an application with no secret cannot be authenticated at all", () => {
  // This is the property that replaces the old `?? "employee-portal-local-secret"`
  // fallback: there is no value a caller can send that satisfies a null hash.
  assert.equal(verifyClientSecret("employee-portal-local-secret", null), false);
  assert.equal(verifyClientSecret("", null), false);
  assert.equal(verifyClientSecret(generateClientSecret(), null), false);
});

test("a non-string secret is rejected rather than coerced", () => {
  const stored = hashClientSecret(generateClientSecret());
  for (const value of [null, undefined, 0, {}, [], true]) {
    assert.equal(verifyClientSecret(value, stored), false, String(value));
  }
});

test("hashing refuses a secret too short to be worth hashing", () => {
  assert.throws(() => hashClientSecret("short"), /at least 16/);
});

test("isProduction reads only NODE_ENV, and defaults to non-production", () => {
  assert.equal(isProduction({ NODE_ENV: "production" }), true);
  assert.equal(isProduction({ NODE_ENV: "development" }), false);
  assert.equal(isProduction({ NODE_ENV: "test" }), false);
  assert.equal(isProduction({}), false);
});
