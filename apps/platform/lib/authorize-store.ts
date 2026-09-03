import { db } from "./supabase";
import type { AuthorizationCodeStore } from "./authorize";

/**
 * The Postgres-backed authorization code store.
 *
 * Split from `lib/authorize.ts` so the rules that decide whether a code may be
 * redeemed stay in a module with no I/O and can be unit tested directly. This file
 * is only the storage.
 *
 * The one thing to notice is `consume`: a single conditional UPDATE that matches
 * on the code, the client, the redirect URI, `used_at IS NULL` and an unexpired
 * `expires_at`, and returns the row it changed. Postgres serialises writes to a
 * row, so of two simultaneous exchanges exactly one gets a row back and the other
 * gets nothing. Reading the row first and then updating it would leave a window
 * where both reads see an unused code — which is the window a replay needs.
 */
export function supabaseCodeStore(): AuthorizationCodeStore {
  return {
    async insert(grant) {
      const { error } = await db().from("authorization_codes").insert({
        code: grant.code,
        client_id: grant.clientId,
        app_slug: grant.appSlug,
        org_id: grant.orgId,
        wallet_address: grant.wallet.toLowerCase(),
        redirect_uri: grant.redirectUri,
        expires_at: grant.expiresAt,
      });
      if (error) throw new Error(`Could not issue an authorization code: ${error.message}`);
    },

    async consume(query) {
      const nowIso = query.now.toISOString();

      const { data, error } = await db()
        .from("authorization_codes")
        .update({ used_at: nowIso })
        .eq("code", query.code)
        .eq("client_id", query.clientId)
        .eq("redirect_uri", query.redirectUri)
        .is("used_at", null)
        .gt("expires_at", nowIso)
        .select("app_slug, org_id, wallet_address, redirect_uri")
        .maybeSingle();

      // A database error is not "the code is invalid" — it is "we do not know".
      // Throwing makes the route answer 503 rather than inventing a decision.
      if (error) throw new Error(`Could not consume the authorization code: ${error.message}`);
      if (!data) return null;

      return {
        appSlug: String(data.app_slug),
        orgId: Number(data.org_id),
        wallet: String(data.wallet_address),
        redirectUri: String(data.redirect_uri),
      };
    },
  };
}
