import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { session } from "@/lib/session";
import { ConfigError, ownexConfig } from "@/lib/config";

/**
 * GET /api/login — start "Sign in with OwneX".
 *
 * The whole of the partner's side of the redirect is here:
 *
 *   1. Generate 32 random bytes of `state` and remember it in the portal's own
 *      encrypted session, with a five-minute lifetime. `state` is what proves the
 *      code arriving at the callback belongs to a request this portal actually
 *      made — without it, an attacker can feed the portal their own code and log
 *      the victim in as somebody else.
 *   2. Redirect to owneX with the client id, the organization, the exact registered
 *      callback, and that state.
 *
 * No wallet library, no contract, no chain. The portal never sees a private key.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  let config;
  try {
    config = ownexConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // A misconfigured integration must be obvious, not silently degraded.
      return NextResponse.json(
        { error: "This portal is not configured for Sign in with owneX", detail: error.message },
        { status: 500 },
      );
    }
    throw error;
  }

  const state = randomBytes(32).toString("base64url");

  const store = await session();
  store.state = state;
  store.stateExpires = Date.now() + 5 * 60_000;
  // Starting a new sign-in invalidates whatever session was there, so a stale
  // wallet cannot survive a half-finished flow.
  store.wallet = undefined;
  store.orgId = undefined;
  store.verifiedAt = undefined;
  await store.save();

  const authorize = new URL("/authorize", `${config.origin}/`);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("org_id", String(config.orgId));
  authorize.searchParams.set("redirect_uri", config.redirectUri);
  authorize.searchParams.set("state", state);

  return NextResponse.redirect(authorize);
}
