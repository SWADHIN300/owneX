/**
 * Seeds the OFF-CHAIN half of the demo data, to match what scripts/seed-demo.ts
 * put on-chain, and creates the storage bucket for asset images.
 *
 *   node scripts/seed-offchain.mjs
 *
 * Idempotent — safe to run repeatedly. Run it after `npm run seed:local` in the
 * contracts workspace, because the org id and token ids come from the chain.
 *
 * Nothing secret is written in plaintext: emails and serial numbers are
 * encrypted with the same AES-256-GCM scheme the app uses, and the identity and
 * asset hashes are computed with the same canonical hashing, so the on-chain
 * anchors match and the "record intact" check passes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { id as keccakUtf8 } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const repoRoot = join(root, "..", "..");

// ── env ───────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const chainId = Number(env.CHAIN_ID ?? env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const seedNetwork = env.OWNEX_SEED_NETWORK ?? (chainId === 11155111 ? "sepolia" : "localhost");
const seedFile = join(repoRoot, "deployments", `${seedNetwork}.seed.json`);
const seedReceipt = existsSync(seedFile) ? JSON.parse(readFileSync(seedFile, "utf8")) : null;

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "User-Agent": "ownex-server/1.0" } },
});

// ── the same crypto and hashing the app uses ──────────────────────────
const encrypt = (plaintext) => {
  if (!plaintext) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(env.PII_ENCRYPTION_KEY, "hex"), iv);
  const data = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(".");
};

const canonical = (v) => {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
};

const hashIdentity = (r) =>
  keccakUtf8(
    `ownex:identity:v1:${canonical({
      displayName: r.displayName.trim(),
      email: r.email?.trim().toLowerCase() ?? null,
      phone: r.phone?.trim() ?? null,
      jobTitle: r.jobTitle?.trim() ?? null,
      department: r.department?.trim() ?? null,
    })}`
  );

const hashAsset = (r) =>
  keccakUtf8(
    `ownex:asset:v1:${canonical({
      orgId: r.orgId,
      name: r.name.trim(),
      assetType: r.assetType.trim(),
      serialNumber: r.serialNumber?.trim() ?? null,
      invoiceReference: r.invoiceReference?.trim() ?? null,
      department: r.department?.trim() ?? null,
    })}`
  );

// ── demo data, mirroring scripts/seed-demo.ts ─────────────────────────
const ORG_ID = Number(seedReceipt?.orgId ?? 1);
const ORIGIN = env.APP_ORIGIN ?? "http://localhost:3000";

const DEFAULT_PEOPLE = [
  { wallet: "0x69FD94d7e3F931F80B658872B70dF5CCa4263888", displayName: "Swadhin (Project Owner)", jobTitle: "Platform Owner", department: "Executive", email: "owner@northwind.example" },
  { wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", displayName: "Priya Sharma", jobTitle: "IT Director", department: "IT", email: "priya@northwind.example" },
  { wallet: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", displayName: "Rahul Verma", jobTitle: "Asset Manager", department: "Operations", email: "rahul@northwind.example" },
  { wallet: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", displayName: "Neha Iyer", jobTitle: "Internal Auditor", department: "Compliance", email: "neha@northwind.example" },
  { wallet: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", displayName: "Arjun Mehta", jobTitle: "Software Engineer", department: "Engineering", email: "arjun@northwind.example" },
  { wallet: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", displayName: "Kavya Rao", jobTitle: "Contract Designer", department: "Design", email: "kavya@northwind.example" },
];

const DEFAULT_ASSETS = [
  { tokenId: 1, name: "Company Laptop 001", assetType: "Laptop", department: "Engineering", serialNumber: "NW-LAP-4471", invoiceReference: "INV-8823", description: "Company-issued laptop, Engineering department." },
  { tokenId: 2, name: "Professional Certificate — ISO 9001", assetType: "Certificate", department: "Compliance", serialNumber: "NW-CERT-0092", invoiceReference: null, description: "ISO 9001 quality management certification." },
  { tokenId: 3, name: "Design Suite License", assetType: "Software License", department: "Design", serialNumber: "NW-LIC-2210", invoiceReference: "INV-9104", description: "Annual design software licence seat." },
];

const PEOPLE = seedReceipt?.people ?? DEFAULT_PEOPLE;
const seedAssetsByName = new Map((seedReceipt?.assets ?? []).map((asset) => [asset.name, asset]));
const ASSETS = DEFAULT_ASSETS.map((asset) => ({
  ...asset,
  tokenId: Number(seedAssetsByName.get(asset.name)?.tokenId ?? asset.tokenId),
}));
const APPLICATION = {
  slug: seedReceipt?.application?.slug ?? "employee-portal",
  name: seedReceipt?.application?.name ?? "Employee Portal",
  url: seedReceipt?.application?.url ?? env.EMPLOYEE_PORTAL_URL ?? "https://ownex-employee-portal.vercel.app",
};

async function main() {
  console.log("─".repeat(62));
  console.log(`seeding off-chain data → ${env.SUPABASE_URL}`);
  if (seedReceipt) console.log(`using seed receipt      deployments/${seedNetwork}.seed.json`);
  console.log("─".repeat(62));

  // ── organization ────────────────────────────────────────────────
  const { error: orgError } = await sb.from("organizations").upsert(
    {
      org_id: ORG_ID,
      name: "Northwind Industries",
      industry: "Manufacturing",
      description: "Demo organization for the OwneX proof of concept.",
      website: "https://northwind.example",
    },
    { onConflict: "org_id" }
  );
  if (orgError) throw new Error(`organizations: ${orgError.message}`);
  console.log("organization   Northwind Industries (#1)");

  // ── profiles ────────────────────────────────────────────────────
  for (const p of PEOPLE) {
    const identityHash = hashIdentity(p);
    const { error } = await sb.from("profiles").upsert(
      {
        wallet_address: p.wallet.toLowerCase(),
        display_name: p.displayName,
        job_title: p.jobTitle,
        department: p.department,
        email_encrypted: encrypt(p.email),
        identity_hash: identityHash,
      },
      { onConflict: "wallet_address" }
    );
    if (error) throw new Error(`profiles ${p.wallet}: ${error.message}`);
    console.log(`profile        ${p.displayName.padEnd(26)} ${p.wallet.slice(0, 10)}…`);
  }

  // ── application ─────────────────────────────────────────────────
  const { error: appError } = await sb.from("applications").upsert(
    {
      org_id: ORG_ID,
      app_slug: APPLICATION.slug,
      app_id: keccakUtf8(APPLICATION.slug),
      name: APPLICATION.name,
      url: APPLICATION.url,
      description: "Web2 staff portal that authenticates through OwneX and holds no blockchain code of its own.",
    },
    { onConflict: "org_id,app_slug" }
  );
  if (appError) throw new Error(`applications: ${appError.message}`);
  console.log("application    Employee Portal");

  // ── assets ──────────────────────────────────────────────────────
  for (const a of ASSETS) {
    const assetHash = hashAsset({ ...a, orgId: ORG_ID });
    const { error } = await sb.from("assets").upsert(
      {
        token_id: a.tokenId,
        org_id: ORG_ID,
        name: a.name,
        description: a.description,
        asset_type: a.assetType,
        department: a.department,
        serial_encrypted: encrypt(a.serialNumber),
        invoice_encrypted: encrypt(a.invoiceReference),
        asset_hash: assetHash,
        metadata_uri: `${ORIGIN}/api/metadata/${a.tokenId}`,
      },
      { onConflict: "token_id" }
    );
    if (error) throw new Error(`assets #${a.tokenId}: ${error.message}`);
    console.log(`asset #${a.tokenId}       ${a.name}`);
  }

  // ── storage bucket for asset images ─────────────────────────────
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some((b) => b.name === "asset-images")) {
    const { error } = await sb.storage.createBucket("asset-images", {
      public: true, // images are display-safe; nothing private is ever uploaded here
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
    });
    if (error) console.log(`storage        could not create bucket: ${error.message}`);
    else console.log("storage        bucket 'asset-images' created (public, 5MB limit)");
  } else {
    console.log("storage        bucket 'asset-images' already present");
  }

  // ── summary ─────────────────────────────────────────────────────
  const counts = {};
  for (const table of ["organizations", "profiles", "applications", "assets", "audit_cache"]) {
    const { count } = await sb.from(table).select("*", { count: "exact", head: true });
    counts[table] = count ?? 0;
  }

  console.log("\n" + "─".repeat(62));
  for (const [table, count] of Object.entries(counts)) {
    console.log(`${table.padEnd(16)} ${count}`);
  }
  console.log("─".repeat(62));
  console.log("\nHashes here use the same canonical scheme as scripts/seed-demo.ts and");
  console.log("apps/platform/lib/hash.ts, so the dashboard integrity check should read");
  console.log("'record intact' for every seeded asset and identity.");
}

main().catch((error) => {
  console.error("\n" + error.message);
  console.error("\nIf tables are missing, apply supabase/schema.sql in the Supabase SQL editor first.");
  process.exitCode = 1;
});
