import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { serverEnv } from "./env";

/**
 * Encrypted, httpOnly session cookie.
 *
 * NOTE WHAT IS *NOT* STORED HERE: the user's role.
 *
 * Caching a role in the cookie would mean an admin revoking someone's access
 * has no effect until the cookie expires. Instead the session stores only
 * "which wallet proved control of its key, and when" — the role is re-read from
 * the contract on every request that depends on it. That is what makes live
 * revocation instant, which is one of the two moments the demo turns on.
 */

export type SessionData = {
  wallet?: string;
  chainId?: number;
  issuedAt?: number; // unix seconds
};

const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h

function options(): SessionOptions {
  const env = serverEnv();
  return {
    password: env.SESSION_PASSWORD,
    cookieName: "ownex_session",
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true, // XSS cannot read it
      sameSite: "lax", // survives the OAuth-style redirect from a partner app
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const store = await cookies();
  return getIronSession<SessionData>(store, options());
}

export async function createSession(wallet: string, chainId: number): Promise<void> {
  const session = await getSession();
  session.wallet = wallet;
  session.chainId = chainId;
  session.issuedAt = Math.floor(Date.now() / 1000);
  await session.save();
}

export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}

/** The authenticated wallet, or null. The ONLY trustworthy source of caller identity. */
export async function sessionWallet(): Promise<string | null> {
  const session = await getSession();
  if (!session.wallet || !session.issuedAt) return null;

  const age = Math.floor(Date.now() / 1000) - session.issuedAt;
  if (age > SESSION_TTL_SECONDS) return null;

  return session.wallet;
}
