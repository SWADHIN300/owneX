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
