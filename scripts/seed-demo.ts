import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Seeds a demo organization so the dashboard has real on-chain data on first run.
 *
 * Produces exactly the state the rehearsed demo path needs:
 *   - Northwind Industries (org #1), root admin = signer #1
 *   - Manager, Auditor, and two Users
 *   - The project MetaMask wallet added as an ADMIN so you can drive the demo
 *     from the browser
 *   - Employee Portal registered with per-role access
 *   - Three asset certificates minted and assigned
 *
 * Run against a local node:
 *   npx hardhat node
 *   npm run deploy:local
 *   npm run seed:local
 *
 * Then seed the off-chain half so names and images appear:
 *   cd apps/platform && node scripts/seed-offchain.mjs
 *
 * ⚠ The hashing below is deliberately IDENTICAL to apps/platform/lib/hash.ts.
 * The on-chain anchor must match what the app computes from the Supabase record,
 * otherwise every seeded asset would show as tampered in the dashboard.
 */

const DEMO_WALLET = process.env.PLATFORM_ADMIN_ADDRESS ?? "0x69FD94d7e3F931F80B658872B70dF5CCa4263888";

// ── canonical hashing — mirror of apps/platform/lib/hash.ts ─────────────
type Json = string | number | boolean | null | Json[] | { [k: string]: Json | undefined };

function canonicalJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as Json)}`).join(",")}}`;
}

const domainHash = (domain: string, payload: Json) => ethers.id(`${domain}:${canonicalJson(payload)}`);

const hashIdentity = (r: { displayName: string; email?: string | null; phone?: string | null; jobTitle?: string | null; department?: string | null }) =>
  domainHash("ownex:identity:v1", {
    displayName: r.displayName.trim(),
    email: r.email?.trim().toLowerCase() ?? null,
    phone: r.phone?.trim() ?? null,
    jobTitle: r.jobTitle?.trim() ?? null,
    department: r.department?.trim() ?? null,
  });

const hashOrganization = (r: { name: string; industry?: string | null; website?: string | null }) =>
  domainHash("ownex:organization:v1", {
    name: r.name.trim(),
    industry: r.industry?.trim() ?? null,
    website: r.website?.trim() ?? null,
  });

const hashAsset = (r: { orgId: number; name: string; assetType: string; serialNumber?: string | null; invoiceReference?: string | null; department?: string | null }) =>
  domainHash("ownex:asset:v1", {
    orgId: r.orgId,
    name: r.name.trim(),
    assetType: r.assetType.trim(),
    serialNumber: r.serialNumber?.trim() ?? null,
    invoiceReference: r.invoiceReference?.trim() ?? null,
    department: r.department?.trim() ?? null,
  });

const hashApplication = (r: { slug: string; name: string; url: string }) =>
  domainHash("ownex:application:v1", { slug: r.slug.trim(), name: r.name.trim(), url: r.url.trim() });

// ── demo data — must match apps/platform/scripts/seed-offchain.mjs ─────
const ORGANIZATION = {
  name: "Northwind Industries",
  industry: "Manufacturing",
  website: "https://northwind.example",
};

const APPLICATION = { slug: "employee-portal", name: "Employee Portal", url: "http://localhost:3001" };

const ASSET_CATALOGUE = [
  {
    name: "Company Laptop 001",
    assetType: "Laptop",
    department: "Engineering",
    serialNumber: "NW-LAP-4471",
    invoiceReference: "INV-8823",
    holderIndex: 4, // employee
    holderLabel: "Arjun Mehta",
  },
  {
    name: "Professional Certificate — ISO 9001",
    assetType: "Certificate",
    department: "Compliance",
    serialNumber: "NW-CERT-0092",
    invoiceReference: null,
    holderIndex: 4, // employee
    holderLabel: "Arjun Mehta",
  },
  {
    name: "Design Suite License",
    assetType: "Software License",
    department: "Design",
    serialNumber: "NW-LIC-2210",
    invoiceReference: "INV-9104",
    holderIndex: 2, // manager
    holderLabel: "Rahul Verma",
  },
];

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No deployment found for network "${network.name}". Run the deploy script first.`);
  }
  const { contracts } = JSON.parse(fs.readFileSync(file, "utf8"));

  const registry = await ethers.getContractAt("IdentityRegistry", contracts.IdentityRegistry);
  const access = await ethers.getContractAt("OrgAccessManager", contracts.OrgAccessManager);
  const assets = await ethers.getContractAt("AssetNFT", contracts.AssetNFT);

  const signers = await ethers.getSigners();
  const [platform, admin, manager, auditor, employee, contractor] = signers;

  const ROLE_ADMIN = await access.ROLE_ADMIN();
  const ROLE_MANAGER = await access.ROLE_MANAGER();
  const ROLE_AUDITOR = await access.ROLE_AUDITOR();
  const ROLE_USER = await access.ROLE_USER();
  const NEVER = 0n;

  console.log("─".repeat(64));
  console.log(`seeding on ${network.name}`);
  console.log("─".repeat(64));

  // ── Fund the browser wallet so MetaMask can transact on the local node ──
  if (network.name === "localhost" || network.name === "hardhat") {
    await network.provider.send("hardhat_setBalance", [DEMO_WALLET, "0x8AC7230489E80000"]); // 10 ETH
    console.log(`funded ${DEMO_WALLET} with 10 ETH (local only)`);
  }

  // ── Identities ─────────────────────────────────────────────────────────
  const people = [
    { wallet: DEMO_WALLET, displayName: "Swadhin (Project Owner)", jobTitle: "Platform Owner", department: "Executive", email: "owner@northwind.example" },
    { wallet: admin.address, displayName: "Priya Sharma", jobTitle: "IT Director", department: "IT", email: "priya@northwind.example" },
    { wallet: manager.address, displayName: "Rahul Verma", jobTitle: "Asset Manager", department: "Operations", email: "rahul@northwind.example" },
    { wallet: auditor.address, displayName: "Neha Iyer", jobTitle: "Internal Auditor", department: "Compliance", email: "neha@northwind.example" },
    { wallet: employee.address, displayName: "Arjun Mehta", jobTitle: "Software Engineer", department: "Engineering", email: "arjun@northwind.example" },
    { wallet: contractor.address, displayName: "Kavya Rao", jobTitle: "Contract Designer", department: "Design", email: "kavya@northwind.example" },
  ];

  for (const person of people) {
    if (await registry.isRegistered(person.wallet)) continue;
    await (await registry.connect(platform).registerIdentityFor(person.wallet, hashIdentity(person))).wait();
    console.log(`identity  ${person.wallet}  ${person.displayName}`);
  }

  // ── Organization ───────────────────────────────────────────────────────
  let orgId = await registry.organizationCount();
  if (orgId === 0n) {
    await (await registry.connect(admin).createOrganization(hashOrganization(ORGANIZATION))).wait();
    orgId = await registry.organizationCount();
    console.log(`\norganization #${orgId}  ${ORGANIZATION.name}  root admin ${admin.address}`);
  }

  // ── Members ────────────────────────────────────────────────────────────
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  const memberships = [
    { wallet: DEMO_WALLET, role: ROLE_ADMIN, expiresAt: NEVER, label: "ADMIN   (your wallet)" },
    { wallet: manager.address, role: ROLE_MANAGER, expiresAt: NEVER, label: "MANAGER Rahul Verma" },
    { wallet: auditor.address, role: ROLE_AUDITOR, expiresAt: NEVER, label: "AUDITOR Neha Iyer" },
    { wallet: employee.address, role: ROLE_USER, expiresAt: NEVER, label: "USER    Arjun Mehta" },
    // Time-bound access: the contractor's role lapses on its own in 30 days.
    { wallet: contractor.address, role: ROLE_USER, expiresAt: now + 30n * 86400n, label: "USER    Kavya Rao (expires in 30d)" },
  ];

  for (const m of memberships) {
    if (await access.isMember(orgId, m.wallet)) continue;
    await (await access.connect(admin).addMember(orgId, m.wallet, m.role, m.expiresAt)).wait();
    console.log(`member    ${m.label}`);
  }

  // ── Connected application (the Web2 SSO demo) ──────────────────────────
  const appId = ethers.id(APPLICATION.slug);
  if (!(await access.applicationRegistered(orgId, appId))) {
    await (await access.connect(admin).registerApplication(orgId, appId, hashApplication(APPLICATION))).wait();
    for (const role of [ROLE_ADMIN, ROLE_MANAGER, ROLE_AUDITOR, ROLE_USER]) {
      await (await access.connect(admin).setAppAccess(orgId, appId, role, true)).wait();
    }
    console.log(`\napplication ${APPLICATION.name} registered, all four roles allowed`);
  }

  // ── Asset certificates ─────────────────────────────────────────────────
  const metadataOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";

  if ((await assets.organizationAssetCount(orgId)) === 0n) {
    console.log("");
    for (const item of ASSET_CATALOGUE) {
      // Serial numbers and invoices stay off-chain and encrypted; only the
      // canonical hash is written to the chain.
      const assetHash = hashAsset({ ...item, orgId: Number(orgId) });
      const tokenId = (await assets.totalMinted()) + 1n;
      const metadataURI = `${metadataOrigin}/api/metadata/${tokenId}`;
      const holder = signers[item.holderIndex].address;

      await (await assets.connect(admin).mintAsset(orgId, holder, assetHash, metadataURI)).wait();
      console.log(`asset #${tokenId}  ${item.name}  →  ${item.holderLabel}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(64));
  console.log(`organization      #${orgId}`);
  console.log(`members           ${await access.memberCount(orgId)}`);
  console.log(`assets minted     ${await assets.organizationAssetCount(orgId)}`);
  console.log(`your wallet role  ADMIN  (${DEMO_WALLET})`);
  console.log("─".repeat(64));
  console.log("\ndemo accounts (import into MetaMask from the `npx hardhat node` output):");
  console.log(`  root admin  ${admin.address}`);
  console.log(`  manager     ${manager.address}`);
  console.log(`  auditor     ${auditor.address}`);
  console.log(`  employee    ${employee.address}`);
  console.log(`  contractor  ${contractor.address}`);
  console.log("\nnext: cd apps/platform && node scripts/seed-offchain.mjs");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
