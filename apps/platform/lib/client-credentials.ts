import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Client credentials for "Sign in with OwneX".
 *
 * Every registered application gets a public `client_id` and a secret it must
 * present from its own backend. The rules that make this safe:
 *
 *   • The secret is 256 bits from `crypto.randomBytes`. Nothing derived from a
 *     slug, a name, or an environment variable — those are guessable, and a
 *     guessable client secret turns the authorization code into a bearer token
 *     anybody can redeem.
 *   • Only a salted scrypt digest is stored. A dump of the `applications` table
 *     therefore yields no usable credential.
 *   • Comparison is constant-time, so a timing oracle cannot recover the digest
 *     byte by byte.
 *   • There is deliberately no fallback value. `verifyClientSecret` returns
 *     false when the stored hash is absent, which means an application that has
 *     never had a secret generated cannot exchange anything — it fails closed
 *     rather than falling back to a shared development string.
 *
 * Node's built-in `crypto` is the only dependency.
 */

export const CLIENT_ID_PREFIX = "ownex_";
export const CLIENT_SECRET_PREFIX = "oxs_";

/** scrypt parameters. 128 * N * r = 16 MiB of memory per verification. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const SALT_BYTES = 16;

const HASH_SCHEME = "scrypt";

/** Public identifier. Not a secret, but unguessable so it cannot be enumerated. */
export function generateClientId(): string {
  return `${CLIENT_ID_PREFIX}${randomBytes(16).toString("hex")}`;
}

/**
 * 32 random bytes, base64url encoded. Shown to the admin exactly once; only the
 * digest below is ever written to the database.
 */
export function generateClientSecret(): string {
  return `${CLIENT_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/**
 * `scrypt$N$r$p$salt$digest`, all base64url.
 *
 * The parameters travel with the digest so they can be raised later without
 * invalidating credentials issued under the old cost.
 */
export function hashClientSecret(secret: string): string {
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error("A client secret must be at least 16 characters");
  }

  const salt = randomBytes(SALT_BYTES);
  const digest = scryptSync(secret, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });

  return [
    HASH_SCHEME,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    digest.toString("base64url"),
  ].join("$");
}

/**
 * Constant-time verification. False for every failure mode — wrong secret,
 * missing secret, unparseable stored value — so a caller cannot distinguish
 * "this application has no secret yet" from "you got the secret wrong".
 */
export function verifyClientSecret(secret: unknown, stored: string | null | undefined): boolean {
  if (typeof secret !== "string" || secret.length === 0) return false;
  if (typeof stored !== "string" || stored.length === 0) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== HASH_SCHEME) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N < 1024 || r < 1 || p < 1) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(secret, salt, expected.length, { N, r, p, maxmem: SCRYPT_MAXMEM });
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Non-secret fingerprint, used only to correlate logs. Never a credential. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Whether this process is running as production.
 *
 * Split out so the security rules that differ between production and local
 * development (HTTPS-only callbacks, authenticated role verification) are decided
 * in one place and can be exercised by a test without mutating `process.env`.
 */
export function isProduction(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production";
}
