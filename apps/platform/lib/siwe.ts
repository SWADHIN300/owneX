import { randomBytes } from "node:crypto";
import { getAddress, verifyMessage } from "ethers";
import { db, normalizeAddress } from "./supabase";
import { serverEnv } from "./env";

/**
 * Sign-In with Ethereum (EIP-4361), implemented directly.
 *
 * THE TRUST BOUNDARY OF THE WHOLE SYSTEM LIVES HERE.
 *
 * A wallet address in a request body proves nothing — addresses are public and
 * anyone can type one. An address only becomes trustworthy once a signature
 * over a server-issued, single-use, short-lived, domain-bound challenge has
 * been recovered back to it. Every check below closes a specific attack:
 *
 *   nonce is server-generated  → the user cannot pick a message we already saw
 *   nonce is single-use        → a captured signature cannot be replayed
 *   nonce expires in 5 min     → a leaked signature has a tiny window
 *   domain is checked          → a signature farmed on evil.com is useless here
 *   chainId is checked         → a signature for another network is rejected
 *   address is checked         → the signature must match the claimed wallet
 *
 * Signing costs no gas: this is a personal_sign message, not a transaction.
 */

const NONCE_TTL_SECONDS = 5 * 60;
const STATEMENT = "Sign in to OwneX. This request is free and will not create a blockchain transaction.";

export type SiweFields = {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: "1";
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
};

/** Canonical EIP-4361 message. Must be byte-identical on both sides. */
export function buildSiweMessage(f: SiweFields): string {
  return [
    `${f.domain} wants you to sign in with your Ethereum account:`,
    f.address,
    "",
    f.statement,
    "",
    `URI: ${f.uri}`,
    `Version: ${f.version}`,
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
  ].join("\n");
}

export type IssuedChallenge = {
  nonce: string;
  message: string;
  expiresAt: string;
};

/** Creates a single-use challenge and records it so it can be consumed once. */
export async function issueChallenge(walletInput: string): Promise<IssuedChallenge> {
  const env = serverEnv();
  const address = getAddress(walletInput); // throws on malformed input, checksums it

  const nonce = randomBytes(16).toString("hex");
  const issuedAtDate = new Date();
  const expiresAtDate = new Date(issuedAtDate.getTime() + NONCE_TTL_SECONDS * 1000);

  const message = buildSiweMessage({
    domain: env.APP_DOMAIN,
    address,
    statement: STATEMENT,
    uri: env.APP_ORIGIN,
    version: "1",
    chainId: env.CHAIN_ID,
    nonce,
    issuedAt: issuedAtDate.toISOString(),
    expirationTime: expiresAtDate.toISOString(),
  });

  const { error } = await db().from("nonces").insert({
    nonce,
    wallet_address: normalizeAddress(address),
    domain: env.APP_DOMAIN,
    issued_at: issuedAtDate.toISOString(),
    expires_at: expiresAtDate.toISOString(),
  });

  if (error) throw new Error(`Could not persist nonce: ${error.message}`);

  return { nonce, message, expiresAt: expiresAtDate.toISOString() };
}

export type VerifyResult =
  | { ok: true; address: string }
  | { ok: false; reason: string };

/**
 * Verifies a signed challenge and consumes the nonce.
 *
 * The caller supplies the exact message they signed; we re-derive the expected
 * message from server state and compare, so a client cannot smuggle different
 * fields past us.
 */
export async function verifyChallenge(params: {
  message: string;
  signature: string;
}): Promise<VerifyResult> {
  const env = serverEnv();
  const parsed = parseSiweMessage(params.message);
  if (!parsed) return { ok: false, reason: "Malformed sign-in message" };

  // ── Field checks before touching cryptography ──────────────────────
  if (parsed.domain !== env.APP_DOMAIN) {
    return { ok: false, reason: "Sign-in message was issued for a different domain" };
  }
  if (parsed.chainId !== env.CHAIN_ID) {
    return { ok: false, reason: `Wrong network. Expected chain ${env.CHAIN_ID}` };
  }
  if (new Date(parsed.expirationTime).getTime() <= Date.now()) {
    return { ok: false, reason: "Sign-in request expired. Please try again." };
  }

  let address: string;
  try {
    address = getAddress(parsed.address);
  } catch {
    return { ok: false, reason: "Invalid address in sign-in message" };
  }

  // ── Nonce must exist, belong to this wallet, be unused and unexpired ──
  const supabase = db();
  const { data: nonceRow, error: nonceError } = await supabase
    .from("nonces")
    .select("nonce, wallet_address, domain, expires_at, used_at")
    .eq("nonce", parsed.nonce)
    .maybeSingle();

  if (nonceError) return { ok: false, reason: "Could not validate sign-in request" };
  if (!nonceRow) return { ok: false, reason: "Unknown or already-used sign-in request" };
  if (nonceRow.used_at) return { ok: false, reason: "This sign-in request was already used" };
  if (new Date(nonceRow.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "Sign-in request expired. Please try again." };
  }
  if (nonceRow.wallet_address !== normalizeAddress(address)) {
    return { ok: false, reason: "Sign-in request was issued for a different wallet" };
  }

  // ── Re-derive the canonical message; reject anything that differs ──
  const expected = buildSiweMessage({
    domain: nonceRow.domain,
    address,
    statement: STATEMENT,
    uri: env.APP_ORIGIN,
    version: "1",
    chainId: env.CHAIN_ID,
    nonce: parsed.nonce,
    issuedAt: parsed.issuedAt,
    expirationTime: parsed.expirationTime,
  });

  if (expected !== params.message) {
    return { ok: false, reason: "Sign-in message does not match the issued challenge" };
  }

  // ── Signature recovery ────────────────────────────────────────────
  let recovered: string;
  try {
    recovered = verifyMessage(params.message, params.signature);
  } catch {
    return { ok: false, reason: "Signature could not be verified" };
  }

  if (getAddress(recovered) !== address) {
    return { ok: false, reason: "Signature does not match the claimed wallet" };
  }

  // ── Consume the nonce. Conditional update = atomic single use. ────
  const { data: consumed, error: consumeError } = await supabase
    .from("nonces")
    .update({ used_at: new Date().toISOString() })
    .eq("nonce", parsed.nonce)
    .is("used_at", null)
    .select("nonce");

  if (consumeError) return { ok: false, reason: "Could not complete sign-in" };
  if (!consumed || consumed.length === 0) {
    // Another request consumed it between our read and write.
    return { ok: false, reason: "This sign-in request was already used" };
  }

  return { ok: true, address };
}

/** Strict parser — anything unexpected yields null rather than a partial object. */
export function parseSiweMessage(message: string): SiweFields | null {
  const lines = message.split("\n");
  if (lines.length < 11) return null;

  const domainMatch = /^(.+) wants you to sign in with your Ethereum account:$/.exec(lines[0]);
  if (!domainMatch) return null;

  const field = (prefix: string): string | null => {
    const line = lines.find((l) => l.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : null;
  };

  const uri = field("URI: ");
  const version = field("Version: ");
  const chainId = field("Chain ID: ");
  const nonce = field("Nonce: ");
  const issuedAt = field("Issued At: ");
  const expirationTime = field("Expiration Time: ");

  if (!uri || version !== "1" || !chainId || !nonce || !issuedAt || !expirationTime) return null;

  return {
    domain: domainMatch[1],
    address: lines[1].trim(),
    statement: lines[3] ?? "",
    uri,
    version: "1",
    chainId: Number(chainId),
    nonce,
    issuedAt,
    expirationTime,
  };
}
