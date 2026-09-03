import { clientAuthHeader, ConfigError, ownexConfig } from "./config";

/**
 * Live access revalidation.
 *
 * Called on every request the portal serves that depends on the user's role. The
 * authorization code told the portal who signed in; this tells it whether that is
 * still true, and what role applies right now.
 *
 * FAIL CLOSED. Every failure — network, non-200, unparseable body — resolves to
 * `allowed: false`. There is no branch that lets an unreachable owneX become an
 * open door, which matters because "the identity provider is down" and "this user
 * was just revoked" look identical from here.
 */

export type VerifyResult = {
  allowed: boolean;
  reason: string | null;
  role: string;
  permissions: Record<string, boolean>;
  identityActive: boolean;
  membership: { joinedAt: number | null; expiresAt: number | null; expired: boolean } | null;
  verifiedAt: string | null;
};

const DENIED = (reason: string): VerifyResult => ({
  allowed: false,
  reason,
  role: "NONE",
  permissions: {},
  identityActive: false,
  membership: null,
  verifiedAt: null,
});

export async function verifyAccess(wallet: string): Promise<VerifyResult> {
  let config;
  try {
    config = ownexConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("[portal] not configured for Sign in with owneX:", error.message);
      return DENIED("PORTAL_NOT_CONFIGURED");
    }
    throw error;
  }

  const url = new URL("/api/roles/verify", `${config.origin}/`);
  url.searchParams.set("wallet", wallet);
  url.searchParams.set("orgId", String(config.orgId));
  url.searchParams.set("app", config.appSlug);

  let response: Response;
  try {
    response = await fetch(url, {
      // The client credentials, server-side. owneX requires them in production and
      // uses them to confirm the caller is this registered application.
      headers: { authorization: clientAuthHeader(config) },
      cache: "no-store",
    });
  } catch (error) {
    console.error("[portal] could not reach owneX for revalidation:", error);
    return DENIED("VERIFICATION_UNAVAILABLE");
  }

  if (!response.ok) {
    // 503 from owneX means it could not read the chain, and it denies rather than
    // guessing. The portal does the same.
    return DENIED(response.status === 503 ? "VERIFICATION_UNAVAILABLE" : `HTTP_${response.status}`);
  }

  let body: Partial<VerifyResult> & { allowed?: boolean };
  try {
    body = (await response.json()) as Partial<VerifyResult>;
  } catch {
    return DENIED("VERIFICATION_UNAVAILABLE");
  }

  if (body.allowed !== true) return DENIED(body.reason ?? "ACCESS_DENIED");

  return {
    allowed: true,
    reason: null,
    role: typeof body.role === "string" ? body.role : "NONE",
    permissions: body.permissions ?? {},
    identityActive: body.identityActive === true,
    membership: body.membership ?? null,
    verifiedAt: typeof body.verifiedAt === "string" ? body.verifiedAt : null,
  };
}
