import { randomBytes } from "node:crypto";
import { db } from "./supabase";
import { checkCallback, type CallbackCheck } from "./callback-allowlist";

/**
 * The callback must be fixed on the server, never supplied by an arbitrary third party.
 *
 * Use `inspectRedirect` when the caller can surface *why* a callback was refused;
 * this boolean wrapper stays for the API routes, which must not leak detail.
 */
export function validRedirect(app: string, uri: string): boolean {
  return checkCallback(app, uri).ok;
}

/** Same decision as `validRedirect`, with the reason attached. */
export function inspectRedirect(app: string, uri: unknown): CallbackCheck {
  return checkCallback(app, uri);
}

export async function issueGrant(g: { wallet: string; app: string; redirectUri: string }) {
  const code = randomBytes(32).toString("hex");
  const { error } = await db().from("authorization_codes").insert({
    code,
    wallet_address: g.wallet.toLowerCase(),
    app_slug: g.app,
    redirect_uri: g.redirectUri,
    expires_at: new Date(Date.now() + 120000).toISOString(),
  });
  if (error) throw error;
  return code;
}

export async function consumeGrant(code: string, app: string, redirectUri: string) {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("authorization_codes")
    .update({ used_at: now })
    .eq("code", code)
    .eq("app_slug", app)
    .eq("redirect_uri", redirectUri)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("wallet_address,app_slug")
    .maybeSingle();

  if (error || !data) return null;
  return { wallet: String(data.wallet_address), app: String(data.app_slug) };
}
