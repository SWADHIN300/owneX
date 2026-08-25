import { Contract, JsonRpcProvider, id as keccakId, ZeroHash } from "ethers";
import { serverEnv } from "../env";

import IdentityRegistryAbi from "./abis/IdentityRegistry.json";
import OrgAccessManagerAbi from "./abis/OrgAccessManager.json";
import AssetNFTAbi from "./abis/AssetNFT.json";

/**
 * Read-only chain access for route handlers.
 *
 * The server NEVER holds a private key and NEVER sends a transaction. Every
 * state change is signed by the user in their own wallet. This module exists
 * only to read authoritative state — roles, ownership, identity status — so
 * authorization decisions come from the contracts rather than from a cache.
 */

// ── Role identifiers — must match the contract constants exactly ──────────
export const ROLE_NONE = ZeroHash;
export const ROLE_ADMIN = keccakId("OWNEX_ROLE_ADMIN");
export const ROLE_MANAGER = keccakId("OWNEX_ROLE_MANAGER");
export const ROLE_AUDITOR = keccakId("OWNEX_ROLE_AUDITOR");
export const ROLE_USER = keccakId("OWNEX_ROLE_USER");

export const PERM_MANAGE_MEMBERS = keccakId("PERM_MANAGE_MEMBERS");
export const PERM_ASSIGN_ROLES = keccakId("PERM_ASSIGN_ROLES");
export const PERM_MINT_ASSETS = keccakId("PERM_MINT_ASSETS");
export const PERM_TRANSFER_ASSETS = keccakId("PERM_TRANSFER_ASSETS");
export const PERM_VIEW_AUDIT = keccakId("PERM_VIEW_AUDIT");
export const PERM_MANAGE_APPS = keccakId("PERM_MANAGE_APPS");

export type RoleName = "ADMIN" | "MANAGER" | "AUDITOR" | "USER" | "NONE";

const ROLE_NAMES: Record<string, RoleName> = {
  [ROLE_ADMIN]: "ADMIN",
  [ROLE_MANAGER]: "MANAGER",
  [ROLE_AUDITOR]: "AUDITOR",
  [ROLE_USER]: "USER",
  [ROLE_NONE]: "NONE",
};

export function roleName(roleHash: string): RoleName {
  return ROLE_NAMES[roleHash.toLowerCase()] ?? ROLE_NAMES[roleHash] ?? "NONE";
}

export function roleHash(name: RoleName): string {
  switch (name) {
    case "ADMIN":
      return ROLE_ADMIN;
    case "MANAGER":
      return ROLE_MANAGER;
    case "AUDITOR":
      return ROLE_AUDITOR;
    case "USER":
      return ROLE_USER;
    default:
      return ROLE_NONE;
  }
}

export const PERMISSION_LIST = [
  { key: "MANAGE_MEMBERS", hash: PERM_MANAGE_MEMBERS, label: "Manage members" },
  { key: "ASSIGN_ROLES", hash: PERM_ASSIGN_ROLES, label: "Assign roles" },
  { key: "MINT_ASSETS", hash: PERM_MINT_ASSETS, label: "Mint assets" },
  { key: "TRANSFER_ASSETS", hash: PERM_TRANSFER_ASSETS, label: "Transfer assets" },
  { key: "VIEW_AUDIT", hash: PERM_VIEW_AUDIT, label: "View audit" },
  { key: "MANAGE_APPS", hash: PERM_MANAGE_APPS, label: "Manage applications" },
] as const;

export type PermissionKey = (typeof PERMISSION_LIST)[number]["key"];

// ── Provider and contracts ────────────────────────────────────────────────

let cachedProvider: JsonRpcProvider | null = null;

export function provider(): JsonRpcProvider {
  if (cachedProvider) return cachedProvider;
  const env = serverEnv();
  cachedProvider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID, {
    staticNetwork: true, // avoids a network probe on every call
  });
  return cachedProvider;
}

export function identityRegistry(): Contract {
  return new Contract(serverEnv().IDENTITY_REGISTRY_ADDRESS, IdentityRegistryAbi, provider());
}

export function accessManager(): Contract {
  return new Contract(serverEnv().ORG_ACCESS_MANAGER_ADDRESS, OrgAccessManagerAbi, provider());
}

export function assetNFT(): Contract {
  return new Contract(serverEnv().ASSET_NFT_ADDRESS, AssetNFTAbi, provider());
}

// ── Authoritative reads ───────────────────────────────────────────────────

export type IdentityState = {
  wallet: string;
  registered: boolean;
  active: boolean;
  identityHash: string | null;
  registeredAt: number | null;
};

export async function readIdentity(wallet: string): Promise<IdentityState> {
  const registry = identityRegistry();
  const record = await registry.getIdentity(wallet);

  return {
    wallet,
    registered: Boolean(record.exists),
    active: Boolean(record.exists) && Boolean(record.active),
    identityHash: record.exists ? String(record.identityHash) : null,
    registeredAt: record.exists ? Number(record.registeredAt) : null,
  };
}

/**
 * The role that applies right now. Returns NONE when the identity is revoked,
 * the membership expired, or the wallet was never a member.
 *
 * This is read fresh from the chain on every sensitive call — never from the
 * session cookie — so an admin revoking access takes effect immediately.
 */
export async function readEffectiveRole(orgId: number | bigint, wallet: string): Promise<RoleName> {
  const hash: string = await accessManager().effectiveRole(orgId, wallet);
  return roleName(hash);
}

export async function readHasPermission(
  orgId: number | bigint,
  wallet: string,
  permissionHash: string
): Promise<boolean> {
  return Boolean(await accessManager().hasPermission(orgId, wallet, permissionHash));
}

export async function readMembership(orgId: number | bigint, wallet: string) {
  const m = await accessManager().getMembership(orgId, wallet);
  const expiresAt = Number(m.expiresAt);
  return {
    role: roleName(String(m.role)),
    joinedAt: Number(m.joinedAt) || null,
    expiresAt: expiresAt === 0 ? null : expiresAt,
    expired: expiresAt !== 0 && expiresAt * 1000 <= Date.now(),
  };
}

export async function readPermissionsFor(orgId: number | bigint, wallet: string) {
  const results = await Promise.all(
    PERMISSION_LIST.map(async (p) => [p.key, await readHasPermission(orgId, wallet, p.hash)] as const)
  );
  return Object.fromEntries(results) as Record<PermissionKey, boolean>;
}

export async function readOrganization(orgId: number | bigint) {
  const org = await identityRegistry().getOrganization(orgId);
  const rootAdmin = String(org.rootAdmin);
  if (rootAdmin === "0x0000000000000000000000000000000000000000") return null;

  return {
    orgId: Number(orgId),
    rootAdmin,
    metadataHash: String(org.metadataHash),
    active: Boolean(org.active),
    createdAt: Number(org.createdAt),
  };
}

export async function readAsset(tokenId: number | bigint) {
  const nft = assetNFT();
  const record = await nft.getAsset(tokenId);
  if (Number(record.orgId) === 0) return null;

  const owner: string = await nft.ownerOf(tokenId);
  return {
    tokenId: Number(tokenId),
    orgId: Number(record.orgId),
    assetHash: String(record.assetHash),
    assignedTo: String(record.assignedTo),
    owner,
    active: Boolean(record.active),
    mintedAt: Number(record.mintedAt),
    transferCount: Number(record.transferCount),
  };
}

export async function readAssetsOfHolder(wallet: string): Promise<number[]> {
  const ids: bigint[] = await assetNFT().assetsOfHolder(wallet);
  return ids.map(Number);
}

export async function readAssetsOfOrganization(orgId: number | bigint): Promise<number[]> {
  const ids: bigint[] = await assetNFT().assetsOfOrganization(orgId);
  return ids.map(Number);
}

export async function readCanAccessApp(orgId: number | bigint, wallet: string, appId: string): Promise<boolean> {
  return Boolean(await accessManager().canAccessApp(orgId, wallet, appId));
}

/** Organizations a wallet currently belongs to, with its live role in each. */
export async function readMemberships(wallet: string) {
  const total = Number(await identityRegistry().organizationCount());
  const orgIds = Array.from({ length: total }, (_, i) => i + 1);

  const entries = await Promise.all(
    orgIds.map(async (orgId) => {
      const role = await readEffectiveRole(orgId, wallet);
      if (role === "NONE") return null;
      const org = await readOrganization(orgId);
      return { orgId, role, active: org?.active ?? false, isRootAdmin: org?.rootAdmin === wallet };
    })
  );

  return entries.filter((e): e is NonNullable<typeof e> => e !== null);
}

/** Slug → on-chain appId. Keep this the single place the mapping happens. */
export function appIdFromSlug(slug: string): string {
  return keccakId(slug);
}
