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
 */

const DEMO_WALLET = process.env.PLATFORM_ADMIN_ADDRESS ?? "0x69FD94d7e3F931F80B658872B70dF5CCa4263888";

/** Off-chain records live in Supabase; only their keccak256 anchor goes on-chain. */
const hash = (label: string, payload: Record<string, unknown>) =>
  ethers.id(`${label}:${JSON.stringify(payload)}`);

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
    { signer: admin, name: "Priya Sharma", title: "IT Director" },
    { signer: manager, name: "Rahul Verma", title: "Asset Manager" },
    { signer: auditor, name: "Neha Iyer", title: "Internal Auditor" },
    { signer: employee, name: "Arjun Mehta", title: "Software Engineer" },
    { signer: contractor, name: "Kavya Rao", title: "Contract Designer" },
  ];

  for (const person of people) {
    if (await registry.isRegistered(person.signer.address)) continue;
    const identityHash = hash("identity", { name: person.name, title: person.title });
    await (await registry.connect(platform).registerIdentityFor(person.signer.address, identityHash)).wait();
    console.log(`identity  ${person.signer.address}  ${person.name}`);
  }

  if (!(await registry.isRegistered(DEMO_WALLET))) {
    await (
      await registry.connect(platform).registerIdentityFor(DEMO_WALLET, hash("identity", { name: "Project Owner" }))
    ).wait();
    console.log(`identity  ${DEMO_WALLET}  Project Owner (your MetaMask wallet)`);
  }

  // ── Organization ───────────────────────────────────────────────────────
  let orgId = await registry.organizationCount();
  if (orgId === 0n) {
    const orgHash = hash("organization", { name: "Northwind Industries", industry: "Manufacturing" });
    await (await registry.connect(admin).createOrganization(orgHash)).wait();
    orgId = await registry.organizationCount();
    console.log(`\norganization #${orgId}  Northwind Industries  root admin ${admin.address}`);
  }

  // ── Members ────────────────────────────────────────────────────────────
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  const memberships: Array<{ wallet: string; role: string; expiresAt: bigint; label: string }> = [
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
  const appId = ethers.id("employee-portal");
  if (!(await access.applicationRegistered(orgId, appId))) {
    const appHash = hash("application", { name: "Employee Portal", url: "http://localhost:3001" });
    await (await access.connect(admin).registerApplication(orgId, appId, appHash)).wait();
    for (const role of [ROLE_ADMIN, ROLE_MANAGER, ROLE_AUDITOR, ROLE_USER]) {
      await (await access.connect(admin).setAppAccess(orgId, appId, role, true)).wait();
    }
    console.log(`\napplication Employee Portal registered, all four roles allowed`);
  }

  // ── Asset certificates ─────────────────────────────────────────────────
  const catalogue = [
    {
      name: "Company Laptop 001",
      assetType: "Laptop",
      serial: "NW-LAP-4471",
      holder: employee.address,
      holderLabel: "Arjun Mehta",
    },
    {
      name: "Professional Certificate — ISO 9001",
      assetType: "Certificate",
      serial: "NW-CERT-0092",
      holder: employee.address,
      holderLabel: "Arjun Mehta",
    },
    {
      name: "Design Suite License",
      assetType: "Software License",
      serial: "NW-LIC-2210",
      holder: manager.address,
      holderLabel: "Rahul Verma",
    },
  ];

  const alreadyMinted = await assets.organizationAssetCount(orgId);
  if (alreadyMinted === 0n) {
    console.log("");
    for (const item of catalogue) {
      // Serial numbers stay off-chain and encrypted; only the anchor is written.
      const assetHash = hash("asset", { name: item.name, serial: item.serial });
      const tokenId = (await assets.totalMinted()) + 1n;
      const metadataURI = `http://localhost:3000/api/metadata/${tokenId}`;

      await (await assets.connect(admin).mintAsset(orgId, item.holder, assetHash, metadataURI)).wait();
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
