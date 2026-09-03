import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INTEGRATION_ENV_VARS,
  integrationEndpoints,
  integrationStage,
  integrationSteps,
  type IntegrationInput,
} from "./integration.ts";

const READY: IntegrationInput = {
  registeredOnChain: true,
  callbackCount: 1,
  hasClientSecret: true,
  rolesAllowedOnChain: 2,
  status: "active",
};

test("a fully wired integration reaches Active", () => {
  assert.equal(integrationStage(READY), "active");
  assert.deepEqual(
    integrationSteps(READY).map((step) => step.done),
    [true, true, true, true, true],
  );
});

test("the pipeline stops at the first missing step", () => {
  assert.equal(integrationStage({ ...READY, registeredOnChain: false }), "draft");
  assert.equal(integrationStage({ ...READY, callbackCount: 0 }), "registered");
  assert.equal(integrationStage({ ...READY, hasClientSecret: false }), "callback");
  assert.equal(integrationStage({ ...READY, rolesAllowedOnChain: 0 }), "secret");
});

test("Active requires a role the CONTRACT admits, not merely a configured one", () => {
  // Everything in the database is in place, but no setAppAccess transaction has
  // landed, so nobody can actually sign in. Showing Active here would be a
  // dashboard telling a comfortable lie.
  const stage = integrationStage({ ...READY, rolesAllowedOnChain: 0 });
  assert.notEqual(stage, "active");
});

test("a revoked integration is not Active, and says how to restore it", () => {
  const steps = integrationSteps({ ...READY, status: "revoked" });
  assert.equal(steps.at(-1)?.done, false);
  assert.match(steps.at(-1)?.todo ?? "", /revoked/i);
  assert.equal(integrationStage({ ...READY, status: "revoked" }), "draft");
});

test("every incomplete step names what to do about it", () => {
  for (const step of integrationSteps({
    registeredOnChain: false,
    callbackCount: 0,
    hasClientSecret: false,
    rolesAllowedOnChain: 0,
    status: "active",
  })) {
    if (!step.done) assert.ok(step.todo.length > 10, step.key);
  }
});

/* -------------------------------------------------------------------------- */

test("the endpoints carry the client id, org and slug the partner needs", () => {
  const endpoints = integrationEndpoints({
    origin: "https://ownex-platform.vercel.app/",
    clientId: "ownex_00000000000000000000000000000001",
    orgId: 1,
    slug: "acme-time-tracking",
    redirectUri: "https://time.acme.com/auth/ownex/callback",
  });

  const authorize = new URL(endpoints.authorizeUrl);
  assert.equal(authorize.origin, "https://ownex-platform.vercel.app");
  assert.equal(authorize.pathname, "/authorize");
  assert.equal(authorize.searchParams.get("client_id"), "ownex_00000000000000000000000000000001");
  assert.equal(authorize.searchParams.get("org_id"), "1");
  assert.equal(
    authorize.searchParams.get("redirect_uri"),
    "https://time.acme.com/auth/ownex/callback",
  );
  assert.ok(authorize.searchParams.get("state"));

  assert.equal(
    endpoints.exchangeUrl,
    "https://ownex-platform.vercel.app/api/authorize/exchange",
  );

  const verify = new URL(endpoints.verifyUrl);
  assert.equal(verify.pathname, "/api/roles/verify");
  assert.equal(verify.searchParams.get("orgId"), "1");
  assert.equal(verify.searchParams.get("app"), "acme-time-tracking");
});

test("a trailing slash on the origin does not produce a doubled path", () => {
  const withSlash = integrationEndpoints({
    origin: "https://ownex.test/",
    clientId: "ownex_00000000000000000000000000000001",
    orgId: 2,
    slug: "app",
  });
  const without = integrationEndpoints({
    origin: "https://ownex.test",
    clientId: "ownex_00000000000000000000000000000001",
    orgId: 2,
    slug: "app",
  });
  assert.equal(withSlash.exchangeUrl, without.exchangeUrl);
  assert.ok(!withSlash.exchangeUrl.includes("//api"));
});

test("the environment variable names are stable, because documentation quotes them", () => {
  assert.deepEqual(INTEGRATION_ENV_VARS, {
    origin: "OWNEX_ORIGIN",
    clientId: "OWNEX_CLIENT_ID",
    clientSecret: "OWNEX_CLIENT_SECRET",
    orgId: "OWNEX_ORG_ID",
    redirectUri: "OWNEX_REDIRECT_URI",
  });
});

test("the client secret is never part of the generated endpoints", () => {
  const endpoints = integrationEndpoints({
    origin: "https://ownex.test",
    clientId: "ownex_00000000000000000000000000000001",
    orgId: 1,
    slug: "app",
  });
  const serialised = JSON.stringify(endpoints);
  assert.equal(serialised.includes("oxs_"), false);
  // Only the NAME of the variable appears, never a value.
  assert.ok(serialised.includes("OWNEX_CLIENT_SECRET"));
});
