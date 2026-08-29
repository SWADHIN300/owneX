import { randomBytes } from "node:crypto";
import { db } from "./supabase";

/** The callback must be fixed on the server, never supplied by an arbitrary third party. */
export function validRedirect(app: string, uri: string): boolean {
  if (app !== "employee-portal") return false;
  if (!uri || typeof uri !== "string") return false;

  const configured = process.env.PORTAL_CALLBACK_URL;
  if (configured && (uri === configured || uri === configured.replace(/\/$/, ""))) {
    return true;
  }

  try {
    const parsed = new URL(uri);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/$/, "");

    const isValidPath =
      pathname === "/callback" ||
      pathname === "/api/callback" ||
      pathname === "" ||
      pathname === "/dashboard";

    // 1. Local development (e.g. localhost:3001, localhost:3000, 127.0.0.1)
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return isValidPath;
    }

    // 2. Production Vercel domain
    if (hostname === "ownex-employee-portal.vercel.app") {
      return isValidPath;
    }

    // 3. Vercel branch / preview deployments (e.g. ownex-employee-portal-git-feat-phase-6-swadhins-projects.vercel.app)
    if (hostname.endsWith(".vercel.app") && hostname.includes("employee-portal")) {
      return isValidPath;
    }

    return false;
  } catch {
    return false;
  }
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
