import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCallbackRedirect,
  canonicalizeCallback,
  checkCallback,
  explainRejection,
  isLoopbackHost,
  validateCallbackList,
  validateRegistrableCallback,
  type CallbackSubject,
} from "./callback-allowlist.ts";

/**
 * Callback validation is the boundary that decides where an authorization code is
 * allowed to travel. Everything below is a rule the previous, Employee-Portal
 * specific implementation either did not have or got wrong:
 *
 *   • it accepted a hard-coded production hostname with no registration at all
 *   • it accepted ANY *.vercel.app host whose name contained "employee-portal",
 *     which an attacker can create
 *   • it accepted a fixed set of paths rather than the exact registered URL
 *   • it accepted http on localhost even in production
 */

const app = (callbacks: string[], status = "active"): CallbackSubject => ({ status, callbacks });

const PARTNER: CallbackSubject = app([
  "https://time.acme.com/auth/ownex/callback",
  "https://staging.time.acme.com/auth/ownex/callback",
]);

/* -------------------------------------------------------------------------- */
/* Exact matching                                                              */
/* -------------------------------------------------------------------------- */

test("accepts a redirect_uri that exactly matches a registered callback", () => {
  const result = checkCallback({
    application: PARTNER,
    uri: "https://time.acme.com/auth/ownex/callback",
    mode: "production",
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.registered, "https://time.acme.com/auth/ownex/callback");
});

test("accepts every registered callback, not only the first", () => {
  const result = checkCallback({
    application: PARTNER,
    uri: "https://staging.time.acme.com/auth/ownex/callback",
    mode: "production",
  });
  assert.equal(result.ok, true);
});

test("normalises trailing slash, default port and host casing", () => {
  for (const uri of [
    "https://time.acme.com/auth/ownex/callback/",
    "https://time.acme.com:443/auth/ownex/callback",
    "https://TIME.ACME.COM/auth/ownex/callback",
    "https://time.acme.com/auth/ownex/callback?ignored=1",
  ]) {
    const result = checkCallback({ application: PARTNER, uri, mode: "production" });
    assert.equal(result.ok, true, `expected ${uri} to be accepted`);
    assert.equal(
      result.ok && result.normalized,
      "https://time.acme.com/auth/ownex/callback",
      uri,
    );
  }
});

test("rejects a different path on a registered host", () => {
  const result = checkCallback({
    application: PARTNER,
    uri: "https://time.acme.com/auth/ownex/callback/steal",
    mode: "production",
  });
  assert.deepEqual(result, { ok: false, reason: "CALLBACK_NOT_REGISTERED" });
});

test("rejects a foreign host outright", () => {
  const result = checkCallback({
    application: PARTNER,
    uri: "https://evil.example.com/auth/ownex/callback",
    mode: "production",
  });
  assert.deepEqual(result, { ok: false, reason: "CALLBACK_NOT_REGISTERED" });
});

test("has no wildcard or substring matching: a look-alike subdomain is refused", () => {
  for (const uri of [
    "https://time.acme.com.evil.test/auth/ownex/callback",
    "https://eviltime.acme.com/auth/ownex/callback",
    "https://time.acme.com.attacker.vercel.app/auth/ownex/callback",
  ]) {
    assert.deepEqual(
      checkCallback({ application: PARTNER, uri, mode: "production" }),
      { ok: false, reason: "CALLBACK_NOT_REGISTERED" },
      uri,
    );
  }
});

test("a vercel preview host is NOT trusted just because it names the app", () => {
  // The old implementation accepted this. Any Vercel account can create a host
  // matching that pattern, so it was an open door.
  const result = checkCallback({
    application: app(["https://ownex-employee-portal.vercel.app/callback"]),
    uri: "https://ownex-employee-portal-git-attacker.vercel.app/callback",
    mode: "production",
  });
  assert.deepEqual(result, { ok: false, reason: "CALLBACK_NOT_REGISTERED" });
});

/* -------------------------------------------------------------------------- */
/* Unknown and revoked applications                                            */
/* -------------------------------------------------------------------------- */

test("rejects an unknown application", () => {
  assert.deepEqual(
    checkCallback({ application: null, uri: "https://time.acme.com/auth/ownex/callback" }),
    { ok: false, reason: "UNKNOWN_APP" },
  );
  assert.deepEqual(
    checkCallback({ application: undefined, uri: "https://time.acme.com/auth/ownex/callback" }),
    { ok: false, reason: "UNKNOWN_APP" },
  );
});

test("rejects a revoked application even for a correctly registered callback", () => {
  const revoked = app(["https://time.acme.com/auth/ownex/callback"], "revoked");
  assert.deepEqual(
    checkCallback({
      application: revoked,
      uri: "https://time.acme.com/auth/ownex/callback",
      mode: "production",
    }),
    { ok: false, reason: "APPLICATION_REVOKED" },
  );
});

test("rejects an application with no callback registered yet", () => {
  assert.deepEqual(
    checkCallback({ application: app([]), uri: "https://time.acme.com/cb", mode: "production" }),
    { ok: false, reason: "NO_CALLBACK_REGISTERED" },
  );
});

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

test("rejects plain http on a remote host", () => {
  const result = checkCallback({
    application: app(["http://time.acme.com/callback"]),
    uri: "http://time.acme.com/callback",
    mode: "production",
  });
  assert.deepEqual(result, { ok: false, reason: "INSECURE_SCHEME" });
});

test("accepts http on localhost in development", () => {
  for (const uri of [
    "http://localhost:3001/callback",
    "http://127.0.0.1:3001/callback",
  ]) {
    const result = checkCallback({
      application: app(["http://localhost:3001/callback", "http://127.0.0.1:3001/callback"]),
      uri,
      mode: "development",
    });
    assert.equal(result.ok, true, uri);
  }
});

test("refuses a localhost callback in production even when it is registered", () => {
  const result = checkCallback({
    application: app(["http://localhost:3001/callback"]),
    uri: "http://localhost:3001/callback",
    mode: "production",
  });
  assert.deepEqual(result, { ok: false, reason: "LOCALHOST_NOT_ALLOWED" });
});

test("recognises the whole loopback range", () => {
  for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.5.5.5", "::1", "[::1]"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ["time.acme.com", "127.0.0.1.evil.test", "localhost.evil.test"]) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

/* -------------------------------------------------------------------------- */
/* Malformed input                                                             */
/* -------------------------------------------------------------------------- */

test("rejects missing, relative and non-http redirect URIs with distinct reasons", () => {
  const application = PARTNER;
  assert.deepEqual(checkCallback({ application, uri: "" }), { ok: false, reason: "MISSING_URI" });
  assert.deepEqual(checkCallback({ application, uri: undefined }), {
    ok: false,
    reason: "MISSING_URI",
  });
  assert.deepEqual(checkCallback({ application, uri: 42 }), { ok: false, reason: "MISSING_URI" });
  assert.deepEqual(checkCallback({ application, uri: "/callback" }), {
    ok: false,
    reason: "MALFORMED_URI",
  });
  assert.deepEqual(checkCallback({ application, uri: "javascript:alert(1)" }), {
    ok: false,
    reason: "UNSUPPORTED_SCHEME",
  });
  assert.deepEqual(checkCallback({ application, uri: "data:text/html,<script>" }), {
    ok: false,
    reason: "UNSUPPORTED_SCHEME",
  });
});

test("rejects an absurdly long URI before parsing it", () => {
  const uri = `https://time.acme.com/${"a".repeat(3000)}`;
  assert.deepEqual(checkCallback({ application: PARTNER, uri }), {
    ok: false,
    reason: "CALLBACK_TOO_LONG",
  });
});

test("canonicalizeCallback returns null for anything not http(s)", () => {
  assert.equal(canonicalizeCallback("ftp://time.acme.com/cb"), null);
  assert.equal(canonicalizeCallback("not a url"), null);
});

/* -------------------------------------------------------------------------- */
/* Registration-time validation                                                */
/* -------------------------------------------------------------------------- */

test("registration accepts https anywhere and http only on localhost in development", () => {
  assert.equal(validateRegistrableCallback("https://time.acme.com/cb", "production").ok, true);
  assert.equal(validateRegistrableCallback("http://localhost:3001/cb", "development").ok, true);
  assert.deepEqual(validateRegistrableCallback("http://time.acme.com/cb", "production"), {
    ok: false,
    reason: "INSECURE_SCHEME",
  });
  assert.deepEqual(validateRegistrableCallback("http://localhost:3001/cb", "production"), {
    ok: false,
    reason: "LOCALHOST_NOT_ALLOWED",
  });
});

test("registration refuses a callback carrying a query string or fragment", () => {
  assert.deepEqual(validateRegistrableCallback("https://time.acme.com/cb?a=1", "production"), {
    ok: false,
    reason: "CALLBACK_HAS_PARAMETERS",
  });
  assert.deepEqual(validateRegistrableCallback("https://time.acme.com/cb#x", "production"), {
    ok: false,
    reason: "CALLBACK_HAS_PARAMETERS",
  });
});

test("validateCallbackList reports every problem, not only the first", () => {
  const problems = validateCallbackList(
    ["https://ok.acme.com/cb", "http://bad.acme.com/cb", "not-a-url"],
    "production",
  );
  assert.equal(problems.length, 2);
  assert.match(problems[0], /http:\/\/bad\.acme\.com\/cb/);
  assert.match(problems[1], /not-a-url/);
});

test("validateCallbackList is empty when every callback is acceptable", () => {
  assert.deepEqual(
    validateCallbackList(["https://a.acme.com/cb", "https://b.acme.com/cb"], "production"),
    [],
  );
});

/* -------------------------------------------------------------------------- */
/* Redirect construction — open redirect prevention                            */
/* -------------------------------------------------------------------------- */

test("the redirect is built from the REGISTERED callback and carries only code and state", () => {
  const url = buildCallbackRedirect("https://time.acme.com/auth/ownex/callback", {
    code: "abc123",
    state: "s-1234567890",
  });
  assert.equal(url.origin, "https://time.acme.com");
  assert.equal(url.pathname, "/auth/ownex/callback");
  assert.equal(url.searchParams.get("code"), "abc123");
  assert.equal(url.searchParams.get("state"), "s-1234567890");
  assert.equal([...url.searchParams.keys()].length, 2);
});

test("a denial carries error and state, and no code", () => {
  const url = buildCallbackRedirect("https://time.acme.com/cb", {
    error: "access_denied",
    state: "s-1234567890",
  });
  assert.equal(url.searchParams.get("error"), "access_denied");
  assert.equal(url.searchParams.get("state"), "s-1234567890");
  assert.equal(url.searchParams.get("code"), null);
});

test("state is preserved verbatim, including characters that need escaping", () => {
  // CSRF protection depends on the partner receiving back exactly what it sent.
  const state = "a+b/c=d&e?f#g ह";
  const url = buildCallbackRedirect("https://time.acme.com/cb", { code: "x", state });
  assert.equal(url.searchParams.get("state"), state);
  // And it survives a round trip through the wire format.
  assert.equal(new URL(url.toString()).searchParams.get("state"), state);
});

test("anything already on the registered callback is discarded, not merged", () => {
  const url = buildCallbackRedirect("https://time.acme.com/cb", {
    code: "x",
    state: "s-1234567890",
  });
  assert.equal(url.hash, "");
  assert.equal([...url.searchParams.keys()].sort().join(","), "code,state");
});

/* -------------------------------------------------------------------------- */

test("every rejection reason has an explanation", () => {
  const reasons = [
    "UNKNOWN_APP",
    "APPLICATION_REVOKED",
    "MISSING_URI",
    "MALFORMED_URI",
    "UNSUPPORTED_SCHEME",
    "INSECURE_SCHEME",
    "LOCALHOST_NOT_ALLOWED",
    "NO_CALLBACK_REGISTERED",
    "CALLBACK_NOT_REGISTERED",
    "CALLBACK_HAS_PARAMETERS",
    "CALLBACK_TOO_LONG",
  ] as const;

  for (const reason of reasons) {
    const explanation = explainRejection(reason);
    assert.equal(typeof explanation, "string");
    assert.ok(explanation.length > 10, reason);
  }
});
