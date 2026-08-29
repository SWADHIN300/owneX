import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

export type PortalSession = {
  wallet?: string;
  state?: string;
  stateExpires?: number;
  role?: string;
  orgId?: number;
  profile?: Record<string, unknown>;
  verifiedAt?: string;
};

function options(): SessionOptions {
  const password =
    process.env.PORTAL_SESSION_PASSWORD && process.env.PORTAL_SESSION_PASSWORD.length >= 32
      ? process.env.PORTAL_SESSION_PASSWORD
      : "ownex-employee-portal-secure-session-password-default-32chars";

  return {
    password,
    cookieName: "ownex_portal",
    ttl: 86400,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  };
}

export async function session() {
  return getIronSession<PortalSession>(await cookies(), options());
}
