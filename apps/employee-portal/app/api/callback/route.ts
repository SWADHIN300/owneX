import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { session } from "@/lib/session";
import { ConfigError, ownexConfig } from "@/lib/config";

/**
 * GET /api/callback — the partner side of the authorization-code flow.
 *
 * THE ORDER OF THESE CHECKS IS THE SECURITY OF THIS ROUTE.
 *
 *   1. `state` first, before the code is looked at at all. It must match the value
 *      stored in this portal's own session, be unexpired, and it is cleared
 *      immediately so it cannot be reused. This is the CSRF defence: without it an
 *      attacker can hand the portal a code obtained for *their* owneX account and
 *      have the victim's browser adopt it.
 *   2. Then any error owneX reported, which is now known to belong to a request
 *      this portal made.
 *   3. Then the exchange, from the server, with the client secret. The code alone
 *      is useless without it.
 *
 * The wallet is taken ONLY from the exchange response. A `?wallet=` parameter is
 * ignored entirely — an address in a URL proves nothing.
 */

export const dynamic = "force-dynamic";

/** Constant-time comparison, so a mismatch leaks nothing through timing. */
function statesMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const error = url.searchParams.get("error") ?? "";

  const origin = new URL("/", request.url).origin;
  const deny = (reason: string) =>
    NextResponse.redirect(new URL(`/denied?reason=${encodeURIComponent(reason)}`, origin));

  const store = await session();
  const expected = store.state;
  const expires = store.stateExpires;

  // Single use: clear it whatever happens next, so a replayed callback finds
  // nothing to match against.
  store.state = undefined;
  store.stateExpires = undefined;
  await store.save();

  if (!state || !expected || !expires || expires < Date.now() || !statesMatch(state, expected)) {
    return deny("INVALID_STATE");
  }

  if (error) return deny(error.toUpperCase());
  if (!code) return deny("INVALID_CODE");

  let config;
  try {
    config = ownexConfig();
  } catch (cause) {
    if (cause instanceof ConfigError) {
      console.error("[portal] not configured for Sign in with owneX:", cause.message);
      return deny("PORTAL_NOT_CONFIGURED");
    }
    throw cause;
  }

  let response: Response;
  try {
    response = await fetch(`${config.origin}/api/authorize/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        // Server-side only. This value must never reach the browser.
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
      }),
      cache: "no-store",
    });
  } catch (cause) {
    console.error("[portal] could not reach owneX to exchange the code:", cause);
    return deny("VERIFICATION_UNAVAILABLE");
  }

  if (!response.ok) {
    // owneX reports a reason code; surface it so the denial page can explain.
    let reason = `EXCHANGE_${response.status}`;
    try {
      const body = (await response.json()) as { code?: string };
      if (body.code) reason = body.code;
    } catch {
      // Keep the status-derived reason.
    }
    return deny(reason);
  }

  const claims = (await response.json()) as {
    wallet?: string;
    orgId?: number;
    identityActive?: boolean;
    verifiedAt?: string;
  };

  if (!claims.wallet || !/^0x[0-9a-fA-F]{40}$/.test(claims.wallet)) {
    return deny("AUTHORIZATION_FAILED");
  }
  // The exchange only succeeds for an active identity, but the portal checks the
  // claim it was given rather than assuming it.
  if (claims.identityActive === false) return deny("IDENTITY_REVOKED");
  if (claims.orgId !== undefined && claims.orgId !== config.orgId) {
    return deny("ORG_MISMATCH");
  }

  store.wallet = claims.wallet.toLowerCase();
  store.orgId = config.orgId;
  store.verifiedAt = claims.verifiedAt ?? new Date().toISOString();
  // The role is deliberately NOT stored. It is re-read on every request, so a
  // revocation takes effect immediately rather than when the cookie expires.
  await store.save();

  return NextResponse.redirect(new URL("/dashboard", origin));
}
