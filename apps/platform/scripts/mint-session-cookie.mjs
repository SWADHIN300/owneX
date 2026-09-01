/**
 * Local verification helper: mint a platform session cookie so the *signed-in*
 * branch of /authorize can be exercised without a wallet signature.
 *
 * Reads SESSION_PASSWORD from .env.local and never prints it.
 * Usage: node scripts/mint-session-cookie.mjs 0xWallet...
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sealData } from "iron-session";

const here = dirname(fileURLToPath(import.meta.url));

function readEnvLocal() {
  const text = readFileSync(join(here, "..", ".env.local"), "utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = readEnvLocal();
let password = env.SESSION_PASSWORD;
if (!password || password.length < 32) {
  password = "ownex-platform-secure-session-password-default-32chars";
}

const wallet = (process.argv[2] ?? "0x70997970C51812dc3A010C7d01b50e0d17dc79C8").toLowerCase();

const sealed = await sealData(
  { wallet, chainId: 11155111, issuedAt: Math.floor(Date.now() / 1000) },
  { password, ttl: 60 * 60 * 24 },
);

// Only the sealed cookie value is printed, never the password.
process.stdout.write(`ownex_session=${sealed}`);
