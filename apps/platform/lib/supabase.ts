import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "./env";

/**
 * Server-only Supabase client using the service role key.
 *
 * ⚠ NEVER import this from a client component. The service role key bypasses
 * Row Level Security. Every table in the schema has RLS on with no permissive
 * policies, which means this client is the ONLY thing that can read or write —
 * and it must stay on the server.
 *
 * Authorization is decided by on-chain role lookups (see lib/authz.ts), not by
 * Supabase. This client is a data store, not a permission system.
 */

let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cached) return cached;

  const env = serverEnv();
  cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        "x-application-name": "ownex-platform",
        // Supabase rejects secret keys sent from anything that looks like a
        // browser. Identify explicitly as a server so that check passes.
        "User-Agent": "ownex-server/1.0",
      },
    },
  });

  return cached;
}

/** Wallet addresses are stored lowercase so lookups are case-insensitive. */
export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

/* ── Postgres failures worth telling apart ─────────────────────────────── */

type DbError = { code?: string | null; message?: string } | null | undefined;

/**
 * A unique constraint was violated.
 *
 * Worth distinguishing because it is not a server fault: something else already
 * holds the value, which is a 409 the caller can act on, not a 500.
 */
export function isUniqueViolation(error: DbError): boolean {
  return error?.code === "23505";
}

/**
 * The column does not exist in this database yet.
 *
 * Migrations are applied by hand in the Supabase SQL editor, so a deploy can
 * legitimately reach a database that is one migration behind. Writes that carry
 * newly added columns detect this and fall back rather than failing outright.
 * PostgREST reports it as PGRST204 when the column is in the request body and
 * 42703 when it is in the select list.
 */
export function isUnknownColumn(error: DbError): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}
