/**
 * Reading a partner application's credentials off a request, and deciding whether
 * a request is allowed to arrive without them.
 *
 * Pure and I/O free so both rules are unit tested directly: the parsing (which is
 * where a `Basic` header is easy to get subtly wrong) and the production gate
 * (which is the one that must never regress). Deliberately importing nothing, so
 * the test can load it without pulling in the chain or the database.
 */

export type PartnerCredentials = { clientId: string; clientSecret: string };

/** `Authorization: Basic base64(client_id ":" client_secret)`. */
export function parseBasicCredentials(header: string | null): PartnerCredentials | null {
  if (!header) return null;

  const match = /^Basic\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(header.trim());
  if (!match) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }

  // The secret may itself contain a colon, so only the FIRST one separates.
  const separator = decoded.indexOf(":");
  if (separator <= 0) return null;

  const clientId = decoded.slice(0, separator);
  const clientSecret = decoded.slice(separator + 1);
  if (clientId.length === 0 || clientSecret.length === 0) return null;

  return { clientId, clientSecret };
}

/**
 * Basic auth first, then the explicit headers. Both are server-to-server forms;
 * neither belongs in browser JavaScript, where the secret would be public.
 */
export function readPartnerCredentials(headers: Headers): PartnerCredentials | null {
  const basic = parseBasicCredentials(headers.get("authorization"));
  if (basic) return basic;

  const clientId = headers.get("x-ownex-client-id");
  const clientSecret = headers.get("x-ownex-client-secret");
  if (clientId && clientSecret && clientId.length > 0 && clientSecret.length > 0) {
    return { clientId, clientSecret };
  }

  return null;
}

/**
 * Whether an unauthenticated call may be answered.
 *
 * False in production, and there is deliberately no environment variable that can
 * turn it back on: a flag that could disable authentication in production would
 * eventually be set. Outside production it is true, because the endpoint reveals
 * only what is already public on-chain and a local integration is far easier to
 * build that way.
 */
export function requiresClientAuth(env: Record<string, string | undefined> = process.env): boolean {
  // Same rule as `isProduction` in lib/client-credentials, restated rather than
  // imported so this module stays dependency-free.
  return env.NODE_ENV === "production";
}
