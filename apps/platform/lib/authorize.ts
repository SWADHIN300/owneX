import { randomBytes } from "node:crypto";

/**
 * Authorization codes for "Sign in with OwneX".
 *
 * A code is the only thing that crosses from the platform to a partner through
 * the user's browser, so it is built to be worth as little as possible if it
 * leaks:
 *
 *   RANDOM      32 bytes from `crypto.randomBytes`. Not a JWT, not derived from
 *               anything — there is nothing in it to forge.
 *   SHORT       Two minutes. Long enough for a redirect, too short to sit in a
 *               referrer log and still be useful.
 *   ONE-TIME    Consumption is a conditional UPDATE ... WHERE used_at IS NULL
 *               that returns the row it changed. Postgres serialises the write,
 *               so two simultaneous exchanges cannot both succeed; the loser gets
 *               no row back and is refused. A read-then-write would have a race
 *               here, which is exactly the window a replay needs.
 *   BOUND       It carries the client id, the exact redirect_uri, the org and the
 *               wallet. Presenting it with a different client id or redirect_uri
 *               fails, so a code captured from one application cannot be redeemed
 *               by another.
 *
 * This module is pure: the store is an interface, so the consumption rules are
 * unit tested directly. `supabaseCodeStore()` in `lib/authorize-store.ts` is the
 * implementation the routes use.
 */

export const AUTHORIZATION_CODE_TTL_MS = 120_000; // 2 minutes

export type GrantInput = {
  clientId: string;
  appSlug: string;
  orgId: number;
  wallet: string;
  /** The exact registered callback the code was issued against. */
  redirectUri: string;
};

export type StoredGrant = GrantInput & {
  code: string;
  expiresAt: string;
};

export type ConsumeQuery = {
  code: string;
  clientId: string;
  redirectUri: string;
  now?: Date;
};

export type ConsumedGrant = {
  appSlug: string;
  orgId: number;
  wallet: string;
  redirectUri: string;
};

export interface AuthorizationCodeStore {
  insert(grant: StoredGrant): Promise<void>;
  /** Must be atomic: returns the grant only if this call is the one that used it. */
  consume(query: { code: string; clientId: string; redirectUri: string; now: Date }): Promise<ConsumedGrant | null>;
}

/** 256 bits, URL-safe. */
export function generateAuthorizationCode(): string {
  return randomBytes(32).toString("base64url");
}

/* -------------------------------------------------------------------------- */
/* In-memory store                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Same rules, no database. Used by the tests to pin the replay, expiry and
 * binding behaviour, and by nothing else — it is process-local, so it would be
 * useless in production and is never wired up there.
 */
export function createMemoryCodeStore(): AuthorizationCodeStore & {
  rows: Map<string, StoredGrant & { usedAt: string | null }>;
} {
  const rows = new Map<string, StoredGrant & { usedAt: string | null }>();

  return {
    rows,
    async insert(grant) {
      if (rows.has(grant.code)) throw new Error("Duplicate authorization code");
      rows.set(grant.code, { ...grant, wallet: grant.wallet.toLowerCase(), usedAt: null });
    },
    async consume(query) {
      const row = rows.get(query.code);
      if (!row) return null;
      if (row.usedAt !== null) return null;
      if (row.clientId !== query.clientId) return null;
      if (row.redirectUri !== query.redirectUri) return null;
      if (new Date(row.expiresAt).getTime() <= query.now.getTime()) return null;

      // Mark first, then answer — the same ordering the conditional UPDATE gives.
      row.usedAt = query.now.toISOString();
      return {
        appSlug: row.appSlug,
        orgId: row.orgId,
        wallet: row.wallet,
        redirectUri: row.redirectUri,
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

export async function issueAuthorizationCode(
  grant: GrantInput,
  store: AuthorizationCodeStore,
  now: Date = new Date(),
): Promise<{ code: string; expiresAt: string }> {
  const code = generateAuthorizationCode();
  const expiresAt = new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS).toISOString();

  await store.insert({ ...grant, code, expiresAt });
  return { code, expiresAt };
}

export async function consumeAuthorizationCode(
  query: ConsumeQuery,
  store: AuthorizationCodeStore,
): Promise<ConsumedGrant | null> {
  // 32 random bytes base64url encoded is 43 characters. Anything shorter cannot
  // be a code this system issued, so it is refused without a lookup.
  if (typeof query.code !== "string" || query.code.length < 32) return null;
  return store.consume({
    code: query.code,
    clientId: query.clientId,
    redirectUri: query.redirectUri,
    now: query.now ?? new Date(),
  });
}
