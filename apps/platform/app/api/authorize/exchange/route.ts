import { z } from "zod";

import { handler, okNoStore, ApiError, readJson } from "@/lib/http";
import {
  RegistryUnavailableError,
  findApplicationByClientId,
} from "@/lib/applications";
import { checkCallback } from "@/lib/callback-allowlist";
import { verifyClientSecret } from "@/lib/client-credentials";
import { consumeAuthorizationCode } from "@/lib/authorize";
import { supabaseCodeStore } from "@/lib/authorize-store";
import { evaluateLiveAccess } from "@/lib/live-access";
import { buildPartnerClaims } from "@/lib/access-decision";

/**
 * POST /api/authorize/exchange — the back-channel.
 *
 * Request:
 *   { client_id, client_secret, code, redirect_uri }
 *
 * Response, and nothing more than this:
 *   { wallet, orgId, role, permissions, identityActive, verifiedAt }
 *
 * This is the only endpoint that turns an authorization code into claims, and it
 * is the reason the code is safe to send through a browser: without the client
 * secret — which lives only in the partner's server environment — a stolen code
 * is inert.
 *
 * WHAT IS CHECKED, IN ORDER
 *   1. The client id resolves to a registered, non-revoked application.
 *   2. The client secret verifies against its scrypt digest, in constant time.
 *   3. The redirect_uri is exactly one this application registered.
 *   4. The code is unexpired, unused, and was issued to THIS client for THIS
 *      redirect_uri — consumed by a conditional update, so a second attempt
 *      finds nothing.
 *   5. The chain still agrees. Access is re-read after the code is consumed, so an
 *      identity revoked in the seconds since consent cannot complete a sign-in.
 *
 * FAILURE IS UNIFORM. Steps 1 to 3 all answer 401 with the same message: a
 * caller probing for valid client ids learns nothing from the difference between
 * "no such client" and "wrong secret".
 */

const exchangeSchema = z.object({
  client_id: z.string().min(8).max(128),
  client_secret: z.string().min(16).max(512),
  // 32 random bytes, base64url encoded, is 43 characters.
  code: z.string().min(32).max(512),
  // Deliberately not `.url()`: a malformed redirect_uri must produce the same
  // uniform 401 as a wrong secret, not a 400 that tells a caller their client id
  // and secret were the parts that passed. `checkCallback` below decides.
  redirect_uri: z.string().min(8).max(2048),
});

const INVALID_CLIENT = () =>
  new ApiError(401, "Invalid client credentials or redirect URI", "INVALID_CLIENT");

export const POST = handler(async (request: Request) => {
  const body = exchangeSchema.parse(await readJson(request));

  let application;
  try {
    application = await findApplicationByClientId(body.client_id);
  } catch (error) {
    if (error instanceof RegistryUnavailableError) {
      throw new ApiError(503, "Authorization is temporarily unavailable", "REGISTRY_UNAVAILABLE");
    }
    throw error;
  }

  // Verify the secret even when the application is missing or revoked, so the
  // response time does not reveal which of the two happened.
  const secretOk = verifyClientSecret(body.client_secret, application?.clientSecretHash ?? null);

  if (!application || application.status === "revoked" || !secretOk) {
    throw INVALID_CLIENT();
  }

  const callback = checkCallback({ application, uri: body.redirect_uri });
  if (!callback.ok) throw INVALID_CLIENT();

  let grant;
  try {
    grant = await consumeAuthorizationCode(
      {
        code: body.code,
        clientId: body.client_id,
        // The registered form, which is what the code was issued against.
        redirectUri: callback.registered,
      },
      supabaseCodeStore(),
    );
  } catch (error) {
    // The store could not tell us whether the code was usable. Refusing with 503
    // is the only honest answer; treating it as "invalid" would be a guess, and
    // treating it as valid would be a replay window.
    console.error("[ownex] authorization code consumption failed:", error);
    throw new ApiError(503, "Authorization is temporarily unavailable", "STORE_UNAVAILABLE");
  }

  if (!grant) {
    throw new ApiError(
      400,
      "Authorization code is invalid, expired, or already used",
      "CODE_REJECTED",
    );
  }

  // Sanity: the grant must belong to the application that just authenticated.
  if (grant.orgId !== application.orgId || grant.appSlug !== application.slug) {
    throw INVALID_CLIENT();
  }

  // The claims are read now, not carried in the code. A code is a one-time
  // pointer to a wallet; everything asserted about that wallet is read live, which
  // is what makes a revocation between consent and exchange take effect.
  const access = await evaluateLiveAccess({
    orgId: grant.orgId,
    wallet: grant.wallet,
    appSlug: grant.appSlug,
  });

  if (!access.ok) {
    throw new ApiError(503, "Could not verify access on-chain", "CHAIN_UNAVAILABLE");
  }

  if (!access.decision.allowed) {
    throw new ApiError(
      403,
      "Access is no longer permitted for this wallet",
      access.decision.reason ?? "ACCESS_DENIED",
    );
  }

  return okNoStore(
    buildPartnerClaims({
      wallet: grant.wallet,
      orgId: grant.orgId,
      role: access.snapshot.role,
      permissions: access.snapshot.permissions,
      identityActive: access.snapshot.identityActive,
    }),
  );
});
