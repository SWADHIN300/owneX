import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { serverEnv } from "./env";

/**
 * AES-256-GCM for personal data at rest.
 *
 * Every value the user would consider private — email, phone, serial numbers,
 * invoice references — is encrypted here before it is written to Supabase, so a
 * database compromise yields ciphertext rather than a leak.
 *
 * Format: v1.<iv-base64>.<authTag-base64>.<ciphertext-base64>
 * The version prefix means the scheme can be rotated later without guessing.
 */

const VERSION = "v1";
const IV_BYTES = 12; // GCM standard

function key(): Buffer {
  return Buffer.from(serverEnv().PII_ENCRYPTION_KEY, "hex");
}

export function encryptPII(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptPII(payload: string | null | undefined): string | null {
  if (!payload) return null;

  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    // Unrecognised format — treat as unreadable rather than throwing, so one
    // corrupt row cannot take down a whole listing endpoint.
    return null;
  }

  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Masks a decrypted value for display to someone who may see that a field
 * exists but has no business reading it in full.
 */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(3, local.length - 2))}@${domain}`;
}

export function maskTail(value: string | null, visible = 4): string | null {
  if (!value) return null;
  if (value.length <= visible) return "•".repeat(value.length);
  return `${"•".repeat(value.length - visible)}${value.slice(-visible)}`;
}

/** Stable fingerprint for cache keys and dedupe. Not a security primitive. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
