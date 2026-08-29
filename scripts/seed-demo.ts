import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Seeds the on-chain half of the demo data.
 *
 * Local networks keep the original Hardhat-account demo.
 * Sepolia uses the deployer as the root admin and reads public browser-wallet
 * addresses from root .env:
 *
 *   PLATFORM_ADMIN_ADDRESS  optional ADMIN member, defaults to deployer
 *   SEED_MANAGER_ADDRESS    required on Sepolia
 *   SEED_AUDITOR_ADDRESS    required on Sepolia
 *   SEED_EMPLOYEE_ADDRESS   required on Sepolia
 *   SEED_CONTRACTOR_ADDRESS optional USER with 30-day access
 *
 * The script is resumable: it checks existing identities, memberships,
 * application access and asset hashes before sending each transaction.
 */

const DEMO_WALLET = process.env.PLATFORM_ADMIN_ADDRESS ?? "0x69FD94d7e3F931F80B658872B70dF5CCa4263888";
const EMPLOYEE_PORTAL_URL = process.env.EMPLOYEE_PORTAL_URL ?? "https://ownex-employee-portal.vercel.app";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json | undefined };
type RoleName = "ADMIN" | "MANAGER" | "AUDITOR" | "USER";
type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

type Person = {
  wallet: string;
  displayName: string;
  jobTitle: string;
  department: string;
  email: string;
};

type Membership = {
  wallet: string;
  roleName: RoleName;
  expiresAt: bigint;
  label: string;
};

type AssetSeed = {
  name: string;
  assetType: string;
  department: string;
  serialNumber: string;
  invoiceReference: string | null;
  holder: string;
  holderLabel: string;
};

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

const ORGANIZATION = {
  name: "Northwind Industries",
  industry: "Manufacturing",
  website: "https://northwind.example",
};

const APPLICATION = { slug: "employee-portal", name: "Employee Portal", url: EMPLOYEE_PORTAL_URL };

function normalizeAddress(value: string, envName: string): string {
  if (!ethers.isAddress(value)) throw new Error(`${envName} must be an EVM address.`);
  return ethers.getAddress(value);
}

function optionalAddress(envName: string): string | null {
  const value = process.env[envName]?.trim();
  return value ? normalizeAddress(value, envName) : null;
}

function requiredAddress(envName: string): string {
  const value = optionalAddress(envName);
  if (!value) throw new Error(`Missing ${envName} in root .env for Sepolia seeding.`);
  return value;
}

function uniquePeople(people: Person[]): Person[] {
  const seen = new Set<string>();
  return people.filter((person) => {
    const key = person.wallet.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function localPeople(signers: Signer[]): { people: Person[]; memberships: Membership[]; assets: AssetSeed[]; orgCreator: Signer; registrar: Signer } {
  if (signers.length < 6) {
    throw new Error("Local seed needs at least six Hardhat signers.");
  }

  const [platform, admin, manager, auditor, employee, contractor] = signers;
  const people = [
    { wallet: DEMO_WALLET, displayName: "Swadhin (Project Owner)", jobTitle: "Platform Owner", department: "Executive", email: "owner@northwind.example" },
    { wallet: admin.address, displayName: "Priya Sharma", jobTitle: "IT Director", department: "IT", email: "priya@northwind.example" },
    { wallet: manager.address, displayName: "Rahul Verma", jobTitle: "Asset Manager", department: "Operations", email: "rahul@northwind.example" },
    { wallet: auditor.address, displayName: "Neha Iyer", jobTitle: "Internal Auditor", department: "Compliance", email: "neha@northwind.example" },
    { wallet: employee.address, displayName: "Arjun Mehta", jobTitle: "Software Engineer", department: "Engineering", email: "arjun@northwind.example" },
    { wallet: contractor.address, displayName: "Kavya Rao", jobTitle: "Contract Designer", department: "Design", email: "kavya@northwind.example" },
  ];

  return {
    registrar: platform,
    orgCreator: admin,
    people,
    memberships: [
      { wallet: DEMO_WALLET, roleName: "ADMIN", expiresAt: 0n, label: "ADMIN   (your wallet)" },
      { wallet: manager.address, roleName: "MANAGER", expiresAt: 0n, label: "MANAGER Rahul Verma" },
      { wallet: auditor.address, roleName: "AUDITOR", expiresAt: 0n, label: "AUDITOR Neha Iyer" },
      { wallet: employee.address, roleName: "USER", expiresAt: 0n, label: "USER    Arjun Mehta" },
      { wallet: contractor.address, roleName: "USER", expiresAt: -1n, label: "USER    Kavya Rao (expires in 30d)" },
    ],
    assets: [
      { name: "Company Laptop 001", assetType: "Laptop", department: "Engineering", serialNumber: "NW-LAP-4471", invoiceReference: "INV-8823", holder: employee.address, holderLabel: "Arjun Mehta" },
      { name: "Professional Certificate — ISO 9001", assetType: "Certificate", department: "Compliance", serialNumber: "NW-CERT-0092", invoiceReference: null, holder: employee.address, holderLabel: "Arjun Mehta" },
      { name: "Design Suite License", assetType: "Software License", department: "Design", serialNumber: "NW-LIC-2210", invoiceReference: "INV-9104", holder: manager.address, holderLabel: "Rahul Verma" },
    ],
  };
}

function sepoliaPeople(deployer: Signer): { people: Person[]; memberships: Membership[]; assets: AssetSeed[]; orgCreator: Signer; registrar: Signer } {
  const platformAdmin = optionalAddress("PLATFORM_ADMIN_ADDRESS") ?? deployer.address;
  const manager = requiredAddress("SEED_MANAGER_ADDRESS");
  const auditor = requiredAddress("SEED_AUDITOR_ADDRESS");
  const employee = requiredAddress("SEED_EMPLOYEE_ADDRESS");
  const contractor = optionalAddress("SEED_CONTRACTOR_ADDRESS");

  const people = uniquePeople([
    { wallet: deployer.address, displayName: "Sepolia Root Admin", jobTitle: "Org Root Admin", department: "Executive", email: "root@northwind.example" },
    { wallet: platformAdmin, displayName: "Swadhin (Project Owner)", jobTitle: "Platform Owner", department: "Executive", email: "owner@northwind.example" },
    { wallet: manager, displayName: "Rahul Verma", jobTitle: "Asset Manager", department: "Operations", email: "rahul@northwind.example" },
    { wallet: auditor, displayName: "Neha Iyer", jobTitle: "Internal Auditor", department: "Compliance", email: "neha@northwind.example" },
    { wallet: employee, displayName: "Arjun Mehta", jobTitle: "Software Engineer", department: "Engineering", email: "arjun@northwind.example" },
    ...(contractor
      ? [{ wallet: contractor, displayName: "Kavya Rao", jobTitle: "Contract Designer", department: "Design", email: "kavya@northwind.example" }]
      : []),
  ]);

  const memberships = [
    ...(platformAdmin.toLowerCase() === deployer.address.toLowerCase()
      ? []
      : [{ wallet: platformAdmin, roleName: "ADMIN" as const, expiresAt: 0n, label: "ADMIN   (platform wallet)" }]),
    { wallet: manager, roleName: "MANAGER" as const, expiresAt: 0n, label: "MANAGER Rahul Verma" },
    { wallet: auditor, roleName: "AUDITOR" as const, expiresAt: 0n, label: "AUDITOR Neha Iyer" },
    { wallet: employee, roleName: "USER" as const, expiresAt: 0n, label: "USER    Arjun Mehta" },
    ...(contractor
      ? [{ wallet: contractor, roleName: "USER" as const, expiresAt: -1n, label: "USER    Kavya Rao (expires in 30d)" }]
      : []),
  ];

  return {
    registrar: deployer,
    orgCreator: deployer,
    people,
    memberships,
    assets: [
      { name: "Company Laptop 001", assetType: "Laptop", department: "Engineering", serialNumber: "NW-LAP-4471", invoiceReference: "INV-8823", holder: employee, holderLabel: "Arjun Mehta" },
      { name: "Professional Certificate — ISO 9001", assetType: "Certificate", department: "Compliance", serialNumber: "NW-CERT-0092", invoiceReference: null, holder: employee, holderLabel: "Arjun Mehta" },
      { name: "Design Suite License", assetType: "Software License", department: "Design", serialNumber: "NW-LIC-2210", invoiceReference: "INV-9104", holder: manager, holderLabel: "Rahul Verma" },
    ],
  };
}

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
  if (signers.length === 0) throw new Error("No signer configured for this network.");

  const context = network.name === "sepolia" ? sepoliaPeople(signers[0]) : localPeople(signers);
  const { registrar, orgCreator, people, memberships, assets: assetSeeds } = context;

  const ROLE_HASH: Record<RoleName, string> = {
    ADMIN: await access.ROLE_ADMIN(),
    MANAGER: await access.ROLE_MANAGER(),
    AUDITOR: await access.ROLE_AUDITOR(),
    USER: await access.ROLE_USER(),
  };
  const txs: { label: string; hash: string; blockNumber: number | null }[] = [];

  async function submit(label: string, request: Promise<{ hash: string; wait: () => Promise<{ blockNumber?: number } | null> }>) {
    const tx = await request;
    console.log(`tx ${label.padEnd(28)} ${tx.hash}`);
    const receipt = await tx.wait();
    txs.push({ label, hash: tx.hash, blockNumber: receipt?.blockNumber ?? null });
    return receipt;
  }

  console.log("-".repeat(64));
  console.log(`seeding on ${network.name}`);
  console.log(`signer ${registrar.address}`);
  console.log("-".repeat(64));

  if (network.name === "localhost" || network.name === "hardhat") {
    await network.provider.send("hardhat_setBalance", [DEMO_WALLET, "0x8AC7230489E80000"]);
    console.log(`funded ${DEMO_WALLET} with 10 ETH (local only)`);
  }

  for (const person of people) {
    if (await registry.isRegistered(person.wallet)) {
      console.log(`identity  ${person.wallet}  already registered`);
      continue;
    }
    await submit(`identity ${person.displayName}`, registry.connect(registrar).registerIdentityFor(person.wallet, hashIdentity(person)));
    console.log(`identity  ${person.wallet}  ${person.displayName}`);
  }

  const organizationHash = hashOrganization(ORGANIZATION);
  let orgId = 0n;
  const orgCount = await registry.organizationCount();
  for (let i = 1n; i <= orgCount; i += 1n) {
    const existing = await registry.getOrganization(i);
    if (
      String(existing.rootAdmin).toLowerCase() === orgCreator.address.toLowerCase() &&
      String(existing.metadataHash).toLowerCase() === organizationHash.toLowerCase()
    ) {
      orgId = i;
      break;
    }
  }

  if (orgId === 0n) {
    await submit("organization Northwind", registry.connect(orgCreator).createOrganization(organizationHash));
    orgId = await registry.organizationCount();
    console.log(`organization #${orgId}  ${ORGANIZATION.name}  root admin ${orgCreator.address}`);
  } else {
    console.log(`organization #${orgId}  already present`);
  }

  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  const resolvedMemberships = memberships.map((m) => ({
    ...m,
    expiresAt: m.expiresAt === -1n ? now + 30n * 86400n : m.expiresAt,
  }));

  for (const m of resolvedMemberships) {
    if (m.wallet.toLowerCase() === orgCreator.address.toLowerCase()) {
      console.log(`member    ${m.label} is root admin`);
      continue;
    }

    const stored = await access.getMembership(orgId, m.wallet);
    if (String(stored.role) !== ethers.ZeroHash) {
      console.log(`member    ${m.label} already present`);
      continue;
    }

    await submit(`member ${m.roleName} ${m.wallet.slice(0, 10)}`, access.connect(orgCreator).addMember(orgId, m.wallet, ROLE_HASH[m.roleName], m.expiresAt));
    console.log(`member    ${m.label}`);
  }

  const appId = ethers.id(APPLICATION.slug);
  if (!(await access.applicationRegistered(orgId, appId))) {
    await submit("application register", access.connect(orgCreator).registerApplication(orgId, appId, hashApplication(APPLICATION)));
    console.log(`application ${APPLICATION.name} registered`);
  } else {
    console.log(`application ${APPLICATION.name} already registered`);
  }

  for (const roleName of ["ADMIN", "MANAGER", "AUDITOR", "USER"] as const) {
    const allowed = await access.appAccessForRole(orgId, appId, ROLE_HASH[roleName]);
    if (allowed) {
      console.log(`app access ${roleName.padEnd(7)} already allowed`);
      continue;
    }
    await submit(`app access ${roleName}`, access.connect(orgCreator).setAppAccess(orgId, appId, ROLE_HASH[roleName], true));
    console.log(`app access ${roleName.padEnd(7)} allowed`);
  }

  const metadataOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  const existingTokenIds: bigint[] = Array.from(await assets.assetsOfOrganization(orgId));
  const seededAssets: { tokenId: number; name: string; assetHash: string; holder: string; metadataURI: string }[] = [];

  for (const item of assetSeeds) {
    const assetHash = hashAsset({ ...item, orgId: Number(orgId) });
    let tokenId = 0n;

    for (const candidate of existingTokenIds) {
      const record = await assets.getAsset(candidate);
      if (String(record.assetHash).toLowerCase() === assetHash.toLowerCase()) {
        tokenId = candidate;
        break;
      }
    }

    if (tokenId === 0n) {
      tokenId = (await assets.totalMinted()) + 1n;
      const metadataURI = `${metadataOrigin}/api/metadata/${tokenId}`;
      await submit(`asset ${item.name}`, assets.connect(orgCreator).mintAsset(orgId, item.holder, assetHash, metadataURI));
      existingTokenIds.push(tokenId);
      console.log(`asset #${tokenId}  ${item.name}  ->  ${item.holderLabel}`);
      seededAssets.push({ tokenId: Number(tokenId), name: item.name, assetHash, holder: item.holder, metadataURI });
      continue;
    }

    const metadataURI = `${metadataOrigin}/api/metadata/${tokenId}`;
    console.log(`asset #${tokenId}  ${item.name} already minted`);
    seededAssets.push({ tokenId: Number(tokenId), name: item.name, assetHash, holder: item.holder, metadataURI });
  }

  const record = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    seededAt: new Date().toISOString(),
    orgId: Number(orgId),
    rootAdmin: orgCreator.address,
    registrar: registrar.address,
    organization: ORGANIZATION,
    application: APPLICATION,
    people,
    memberships: resolvedMemberships.map((m) => ({
      wallet: m.wallet,
      role: m.roleName,
      expiresAt: m.expiresAt.toString(),
      label: m.label,
    })),
    assets: seededAssets,
    transactions: txs,
  };

  const out = path.join(__dirname, "..", "deployments", `${network.name}.seed.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);

  console.log("\n" + "-".repeat(64));
  console.log(`organization      #${orgId}`);
  console.log(`members           ${await access.memberCount(orgId)}`);
  console.log(`assets minted     ${await assets.organizationAssetCount(orgId)}`);
  console.log(`seed receipt      deployments/${network.name}.seed.json`);
  console.log("-".repeat(64));
  console.log("\ndemo addresses:");
  for (const person of people) {
    console.log(`  ${person.displayName.padEnd(24)} ${person.wallet}`);
  }
  console.log("\nnext: npm run seed:offchain");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
