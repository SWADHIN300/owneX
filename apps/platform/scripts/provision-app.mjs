/**
 * Provision a "Sign in with OwneX" integration from the command line.
 *
 *   node scripts/provision-app.mjs --slug employee-portal \
 *     --name "Employee Portal" \
 *     --url http://localhost:3001 \
 *     --callback http://localhost:3001/callback \
 *     --roles ADMIN,MANAGER,AUDITOR,USER \
 *     [--org 1] [--rotate]
 *
 * WHAT IT DOES AND DOES NOT DO
 *   It writes the integration CONFIGURATION only: the display record, the callback
 *   URLs, the intended roles, a client id, and the scrypt digest of a freshly
 *   generated client secret. It prints that secret once.
 *
 *   It does NOT register the application on-chain and does NOT grant any role
 *   access. Those are `registerApplication` and `setAppAccess`, which an
 *   organization admin signs with their own wallet from /dashboard/applications.
 *   This script holds no key and cannot sign anything, so it cannot give anybody
 *   access to anything — which is exactly the property that makes it safe to have.
 *
 * Existing rows are preserved: without --rotate, an application that already has a
 * secret keeps it, and only its configuration is updated.
 *
 * The hash format and parameters are identical to lib/client-credentials.ts. If one
 * changes, change the other.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { id as keccakUtf8 } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/* ── arguments ─────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : fallback;
};
const has = (name) => args.includes(`--${name}`);

const slug = flag("slug");
const name = flag("name");
const url = flag("url");
const callbacks = args
  .flatMap((value, index) => (value === "--callback" ? [args[index + 1]] : []))
  .filter(Boolean);
const roles = (flag("roles", "USER") ?? "USER")
  .split(",")
  .map((role) => role.trim().toUpperCase())
  .filter(Boolean);
const orgId = Number(flag("org", "1"));
const description = flag("description");
const logoUrl = flag("logo");
const rotate = has("rotate");

if (!slug || !name || !url || callbacks.length === 0) {
  console.error(
    "Usage: node scripts/provision-app.mjs --slug <slug> --name <name> --url <homepage> --callback <exact-callback-url> [--callback ...] [--roles ADMIN,USER] [--org 1] [--description ...] [--logo ...] [--rotate]",
  );
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
  console.error("The slug must be lowercase letters, digits and hyphens.");
  process.exit(1);
}

const VALID_ROLES = ["ADMIN", "MANAGER", "AUDITOR", "USER"];
for (const role of roles) {
  if (!VALID_ROLES.includes(role)) {
    console.error(`Unknown role "${role}". Valid roles: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }
}

/* ── callback validation, mirroring lib/callback-allowlist.ts ──────── */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
for (const callback of callbacks) {
  let parsed;
  try {
    parsed = new URL(callback);
  } catch {
    console.error(`Callback "${callback}" is not an absolute URL.`);
    process.exit(1);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    console.error(`Callback "${callback}" must use http or https.`);
    process.exit(1);
  }
  if (parsed.search || parsed.hash) {
    console.error(`Callback "${callback}" must not contain a query string or fragment.`);
    process.exit(1);
  }
  if (!LOOPBACK.has(parsed.hostname) && parsed.protocol !== "https:") {
    console.error(`Callback "${callback}" must use https because it is not on localhost.`);
    process.exit(1);
  }
}

/* ── env ───────────────────────────────────────────────────────────── */

// OWNEX_ENV_FILE lets this run against a different environment file — a staging
// project, or the local verification stack — without editing or swapping
// .env.local, which is where a developer's real credentials live.
const envFile = process.env.OWNEX_ENV_FILE
  ? join(process.cwd(), process.env.OWNEX_ENV_FILE)
  : join(root, ".env.local");

const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
);

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in apps/platform/.env.local");
  process.exit(1);
}

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "User-Agent": "ownex-server/1.0" } },
});

/* ── credentials — identical to lib/client-credentials.ts ──────────── */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

const generateClientId = () => `ownex_${randomBytes(16).toString("hex")}`;
const generateClientSecret = () => `oxs_${randomBytes(32).toString("base64url")}`;
const hashClientSecret = (secret) => {
  const salt = randomBytes(16);
  const digest = scryptSync(secret, salt, SCRYPT.keylen, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    digest.toString("base64url"),
  ].join("$");
};

/* ── write ─────────────────────────────────────────────────────────── */

const { data: existing, error: readError } = await sb
  .from("applications")
  .select("client_id, client_secret_hash, status")
  .eq("org_id", orgId)
  .eq("app_slug", slug)
  .maybeSingle();

if (readError) {
  console.error(`Could not read the application: ${readError.message}`);
  process.exit(1);
}

const clientId = existing?.client_id ?? generateClientId();
const issueSecret = rotate || !existing?.client_secret_hash;
const clientSecret = issueSecret ? generateClientSecret() : null;

const row = {
  org_id: orgId,
  app_slug: slug,
  app_id: keccakUtf8(slug),
  name,
  url,
  description: description ?? null,
  logo_url: logoUrl ?? null,
  client_id: clientId,
  allowed_roles: roles,
  status: existing?.status === "revoked" ? "revoked" : "active",
};

if (clientSecret) {
  row.client_secret_hash = hashClientSecret(clientSecret);
  row.client_secret_updated_at = new Date().toISOString();
}

const { error: upsertError } = await sb
  .from("applications")
  .upsert(row, { onConflict: "org_id,app_slug" });

if (upsertError) {
  console.error(`Could not save the application: ${upsertError.message}`);
  process.exit(1);
}

// Replace rather than merge: a callback the operator dropped must actually stop
// being accepted.
const { error: deleteError } = await sb
  .from("application_callbacks")
  .delete()
  .eq("org_id", orgId)
  .eq("app_slug", slug);

if (deleteError) {
  console.error(`Could not replace callback URLs: ${deleteError.message}`);
  process.exit(1);
}

const { error: insertError } = await sb.from("application_callbacks").insert(
  [...new Set(callbacks)].map((callback_url) => ({ org_id: orgId, app_slug: slug, callback_url })),
);

if (insertError) {
  console.error(`Could not save callback URLs: ${insertError.message}`);
  process.exit(1);
}

/* ── report ────────────────────────────────────────────────────────── */

const origin = (env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");

console.log(`\n✓ Integration configuration saved for "${slug}" in organization ${orgId}.\n`);
console.log(`OWNEX_ORIGIN=${origin}`);
console.log(`OWNEX_CLIENT_ID=${clientId}`);
if (clientSecret) {
  console.log(`OWNEX_CLIENT_SECRET=${clientSecret}`);
} else {
  console.log("OWNEX_CLIENT_SECRET=<unchanged — pass --rotate to issue a new one>");
}
console.log(`OWNEX_ORG_ID=${orgId}`);
console.log(`OWNEX_REDIRECT_URI=${callbacks[0]}`);
console.log(`OWNEX_APP_SLUG=${slug}`);

if (clientSecret) {
  console.log(
    "\n⚠ The client secret above is stored only as a scrypt digest and cannot be shown again.",
  );
  console.log("  Put it in the partner application's SERVER environment. Never in frontend code.");
  if (rotate) console.log("  The previous secret has stopped working.");
}

console.log("\nStill required, and only an organization admin can do it:");
console.log(`  1. Sign registerApplication(${orgId}, ${keccakUtf8(slug)}, <metadataHash>)`);
console.log(`  2. Sign setAppAccess for each of: ${roles.join(", ")}`);
console.log("  Both are on /dashboard/applications. Until they land, every sign-in is refused.\n");
