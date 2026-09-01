import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCallback, configuredCallbacks, PRODUCTION_PORTAL_HOST } from "./callback-allowlist.ts";

const PROD = `https://${PRODUCTION_PORTAL_HOST}/callback`;
const NO_ENV: Record<string, string | undefined> = {};

test("accepts the production portal callback with no configuration at all", () => {
  const result = checkCallback("employee-portal", PROD, NO_ENV);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.matchedBy, "production");
});

test("accepts the production callback even when PORTAL_CALLBACK_URL pins localhost", () => {
  // The regression that produced the "callback URI is not registered" page: a
  // platform deployment still carrying the development callback must not lock the
  // real portal out.
  const result = checkCallback("employee-portal", PROD, {
    PORTAL_CALLBACK_URL: "http://localhost:3001/callback",
  });
  assert.equal(result.ok, true);
});

test("normalises trailing slash, default port and host casing", () => {
  for (const uri of [
    `https://${PRODUCTION_PORTAL_HOST}/callback/`,
    `https://${PRODUCTION_PORTAL_HOST}:443/callback`,
    `https://${PRODUCTION_PORTAL_HOST.toUpperCase()}/callback`,
    `https://${PRODUCTION_PORTAL_HOST}/callback?foo=bar`,
  ]) {
    const result = checkCallback("employee-portal", uri, NO_ENV);
    assert.equal(result.ok, true, `expected ${uri} to be allowed`);
    assert.equal(result.ok && result.normalized, `https://${PRODUCTION_PORTAL_HOST}/callback`);
  }
});

test("accepts vercel preview deployments of the portal", () => {
  const result = checkCallback(
    "employee-portal",
    "https://ownex-employee-portal-git-feat-phase-6-swadhins-projects.vercel.app/callback",
    NO_ENV,
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.matchedBy, "preview");
});

test("accepts local development over http", () => {
  for (const uri of ["http://localhost:3001/callback", "http://127.0.0.1:3001/api/callback"]) {
    assert.equal(checkCallback("employee-portal", uri, NO_ENV).ok, true, uri);
  }
});

test("accepts a custom domain once added to PORTAL_CALLBACK_URLS", () => {
  const env = { PORTAL_CALLBACK_URLS: "https://portal.ownex.io/callback, https://hr.acme.com/callback" };
  assert.equal(checkCallback("employee-portal", "https://portal.ownex.io/callback", env).ok, true);
  assert.equal(checkCallback("employee-portal", "https://hr.acme.com/callback", env).ok, true);
  assert.equal(checkCallback("employee-portal", "https://portal.ownex.io/callback/", env).ok, true);
});

test("rejects a foreign host with HOST_NOT_ALLOWED", () => {
  const result = checkCallback("employee-portal", "https://evil.example.com/callback", NO_ENV);
  assert.deepEqual(result, { ok: false, reason: "HOST_NOT_ALLOWED" });
});

test("rejects a look-alike vercel host that is not this portal", () => {
  const result = checkCallback("employee-portal", "https://attacker.vercel.app/callback", NO_ENV);
  assert.deepEqual(result, { ok: false, reason: "HOST_NOT_ALLOWED" });
});

test("rejects plain http on a remote host", () => {
  const result = checkCallback("employee-portal", `http://${PRODUCTION_PORTAL_HOST}/callback`, NO_ENV);
  assert.deepEqual(result, { ok: false, reason: "INSECURE_SCHEME" });
});

test("rejects an unexpected path on an allowed host", () => {
  const result = checkCallback("employee-portal", `https://${PRODUCTION_PORTAL_HOST}/steal`, NO_ENV);
  assert.deepEqual(result, { ok: false, reason: "PATH_NOT_ALLOWED" });
});

test("rejects other apps and bad input with distinct reasons", () => {
  assert.deepEqual(checkCallback("some-other-app", PROD, NO_ENV), { ok: false, reason: "UNKNOWN_APP" });
  assert.deepEqual(checkCallback("employee-portal", "", NO_ENV), { ok: false, reason: "MISSING_URI" });
  assert.deepEqual(checkCallback("employee-portal", undefined, NO_ENV), { ok: false, reason: "MISSING_URI" });
  assert.deepEqual(checkCallback("employee-portal", "/callback", NO_ENV), { ok: false, reason: "MALFORMED_URI" });
  assert.deepEqual(checkCallback("employee-portal", "javascript:alert(1)", NO_ENV), {
    ok: false,
    reason: "UNSUPPORTED_SCHEME",
  });
});

test("configuredCallbacks merges and trims both env vars", () => {
  assert.deepEqual(
    configuredCallbacks({
      PORTAL_CALLBACK_URL: " https://a.test/callback ",
      PORTAL_CALLBACK_URLS: "https://b.test/callback , ,https://c.test/callback",
    }),
    ["https://a.test/callback", "https://b.test/callback", "https://c.test/callback"],
  );
  assert.deepEqual(configuredCallbacks({}), []);
});
