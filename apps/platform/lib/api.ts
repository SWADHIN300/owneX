/**
 * Typed client for the owneX API.
 *
 * The session is an httpOnly cookie set by the server, so every call sends
 * credentials and none of them take a token. A 401 means "not signed in" and is
 * returned rather than thrown, because for `getMe` that is an ordinary state, not
 * an error.
 */

export interface ApiErrorShape {
  status: number;
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor({ status, code, message }: ApiErrorShape) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string; code?: string; message?: string };
    throw new ApiRequestError({
      status: response.status,
      code: body.code ?? "REQUEST_FAILED",
      message: body.error ?? body.message ?? `Request failed with ${response.status}`,
    });
  }

  return payload as T;
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export interface Challenge {
  nonce: string;
  message: string;
  expiresAt: string;
  gasRequired: boolean;
}

export function requestChallenge(wallet: string): Promise<Challenge> {
  return request<Challenge>("/api/auth/nonce", {
    method: "POST",
    body: JSON.stringify({ wallet }),
  });
}

export interface Membership {
  orgId: number;
  role: string;
  expiresAt: number | null;
}

export interface VerifyResult {
  wallet: string;
  identity: { registered: boolean; active: boolean; identityHash: string | null };
  memberships: Membership[];
  profile: { display_name?: string | null } | null;
  /** Where the client should route next. */
  next: "onboarding" | "no-organization" | "dashboard";
}

export function verifySignature(message: string, signature: string): Promise<VerifyResult> {
  return request<VerifyResult>("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ message, signature }),
  });
}

export function signOut(): Promise<unknown> {
  return request("/api/auth/logout", { method: "POST" });
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export interface Me {
  wallet: string;
  identity: {
    registered: boolean;
    active: boolean;
    identityHash: string | null;
    registeredAt: number | null;
    did: string;
    /** Null when either side has no hash to compare. */
    recordIntact: boolean | null;
  };
  profile: {
    displayName: string | null;
    jobTitle: string | null;
    department: string | null;
    avatarUrl: string | null;
    email: string | null;
    emailMasked: string | null;
  } | null;
  activeOrgId: number | null;
  memberships: Membership[];
  permissions: string[] | null;
  assets: number[];
}

/**
 * Current user, or `null` when there is no valid session. A 401 here is the
 * ordinary signed-out state, so it is not treated as a failure.
 */
export async function getMe(orgId?: number): Promise<Me | null> {
  const query = orgId !== undefined ? `?orgId=${orgId}` : "";
  try {
    return await request<Me>(`/api/identity/me${query}`);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Health                                                                      */
/* -------------------------------------------------------------------------- */

export interface Health {
  ok: boolean;
  chainId?: number;
  [key: string]: unknown;
}

export function getHealth(): Promise<Health> {
  return request<Health>("/api/health");
}
