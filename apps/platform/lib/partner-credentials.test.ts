import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseBasicCredentials,
  readPartnerCredentials,
  requiresClientAuth,
} from "./partner-credentials.ts";

const basic = (clientId: string, clientSecret: string) =>
  `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

test("Basic auth is decoded", () => {
  assert.deepEqual(parseBasicCredentials(basic("ownex_abc", "oxs_secret")), {
    clientId: "ownex_abc",
    clientSecret: "oxs_secret",
  });
});

test("only the first colon separates, so a secret may contain colons", () => {
  assert.deepEqual(parseBasicCredentials(basic("ownex_abc", "a:b:c")), {
    clientId: "ownex_abc",
    clientSecret: "a:b:c",
  });
});

test("the scheme is matched case-insensitively, as RFC 7235 requires", () => {
  const header = basic("ownex_abc", "oxs_secret").replace("Basic", "basic");
  assert.deepEqual(parseBasicCredentials(header), {
    clientId: "ownex_abc",
    clientSecret: "oxs_secret",
  });
});

test("malformed Basic headers yield nothing rather than a partial credential", () => {
  for (const header of [
    null,
    "",
    "Basic",
    "Basic ",
    "Bearer abc",
    `Basic ${Buffer.from("no-colon").toString("base64")}`,
    `Basic ${Buffer.from(":secret-only").toString("base64")}`,
    `Basic ${Buffer.from("id-only:").toString("base64")}`,
    "Basic !!!not base64!!!",
  ]) {
    assert.equal(parseBasicCredentials(header), null, String(header));
  }
});

test("the explicit headers are accepted as an alternative", () => {
  const headers = new Headers({
    "x-ownex-client-id": "ownex_abc",
    "x-ownex-client-secret": "oxs_secret",
  });
  assert.deepEqual(readPartnerCredentials(headers), {
    clientId: "ownex_abc",
    clientSecret: "oxs_secret",
  });
});

test("half a credential is no credential", () => {
  assert.equal(readPartnerCredentials(new Headers({ "x-ownex-client-id": "ownex_abc" })), null);
  assert.equal(
    readPartnerCredentials(new Headers({ "x-ownex-client-secret": "oxs_secret" })),
    null,
  );
  assert.equal(readPartnerCredentials(new Headers()), null);
});

test("Basic auth wins when both forms are present", () => {
  const headers = new Headers({
    authorization: basic("ownex_from_basic", "oxs_basic"),
    "x-ownex-client-id": "ownex_from_header",
    "x-ownex-client-secret": "oxs_header",
  });
  assert.deepEqual(readPartnerCredentials(headers), {
    clientId: "ownex_from_basic",
    clientSecret: "oxs_basic",
  });
});

test("production requires client authentication, and nothing can switch that off", () => {
  assert.equal(requiresClientAuth({ NODE_ENV: "production" }), true);
  // There is deliberately no opt-out, so these have no effect.
  assert.equal(
    requiresClientAuth({ NODE_ENV: "production", ALLOW_PUBLIC_ROLE_VERIFY: "true" }),
    true,
  );
  assert.equal(
    requiresClientAuth({ NODE_ENV: "production", OWNEX_PUBLIC_VERIFY: "1", DEBUG: "1" }),
    true,
  );
});

test("development answers unauthenticated calls, which is the documented dev-only mode", () => {
  assert.equal(requiresClientAuth({ NODE_ENV: "development" }), false);
  assert.equal(requiresClientAuth({ NODE_ENV: "test" }), false);
  assert.equal(requiresClientAuth({}), false);
});
