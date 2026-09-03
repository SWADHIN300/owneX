import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

/**
 * The portal's own session — encrypted, httpOnly, and entirely separate from
 * owneX's.
 *
 * WHAT IS STORED, AND WHAT IS NOT
 *   Stored: the wallet address owneX verified, the organization, and when. Also
 *   the pending `state` while an authorization request is in flight.
 *
 *   NOT stored: the role. Caching a role in a cookie would mean an admin revoking
 *   somebody's access has no effect until the cookie expires. The role is re-read
 *   from owneX — which reads it from the contract — on every request that depends
 *   on it. That is what makes revocation take effect immediately.
 *
 * The wallet in this cookie is only ever written after a successful code
 * exchange. It is never taken from a URL parameter: a `?wallet=` value proves
 * nothing, because addresses are public and anyone can type one.
 */

export type PortalSession = {
  /** Verified by owneX through the code exchange. Never read from a URL. */
  wallet?: string;
  orgId?: number;
  verifiedAt?: string;
  /** Anti-CSRF value for an authorization request that has not returned yet. */
  state?: string;
  stateExpires?: number;
};

const SESSION_TTL_SECONDS = 60 * 60 * 8;

function options(): SessionOptions {
  const password = process.env.PORTAL_SESSION_PASSWORD ?? "";

  // 32+ characters is iron-session's requirement, and there is no default: a
  // predictable cookie password means forgeable sessions.
  if (password.length < 32) {
    throw new Error(
      "PORTAL_SESSION_PASSWORD must be set to at least 32 high-entropy characters. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
    );
  }

  return {
    password,
    cookieName: "ownex_portal",
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true, // XSS cannot read it
      sameSite: "lax", // survives the redirect back from owneX
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  };
}

export async function session() {
  return getIronSession<PortalSession>(await cookies(), options());
}

/** The signed-in wallet, or null. The only trustworthy source of caller identity. */
export async function sessionWallet(): Promise<string | null> {
  try {
    const store = await session();
    return store.wallet ?? null;
  } catch {
    return null;
  }
}
