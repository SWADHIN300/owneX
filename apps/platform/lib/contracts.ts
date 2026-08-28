/**
 * Contracts, from the browser.
 *
 * The server has full ABIs in `lib/chain/abis`. This does not import them: the
 * three of them are roughly 60KB of JSON and the browser needs six functions,
 * one event and the errors they can throw. Human-readable fragments keep the
 * bundle small and, more usefully, make the app's entire write surface a list you
 * can read in one screen — if a function is not here, the interface cannot call
 * it.
 *
 * The error fragments matter as much as the functions. Without them a revert
 * arrives as an unreadable four-byte selector; with them ethers decodes the name
 * and arguments, which is what lets a failure say "you cannot promote yourself"
 * instead of "execution reverted".
 */

import {
  BrowserProvider,
  Contract,
  id as keccakUtf8,
  type Eip1193Provider as EthersEip1193Provider,
  type Signer,
} from "ethers";

/* -------------------------------------------------------------------------- */
/* Addresses                                                                   */
/* -------------------------------------------------------------------------- */

export const ADDRESSES = {
  identityRegistry: process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS ?? "",
  orgAccessManager: process.env.NEXT_PUBLIC_ORG_ACCESS_MANAGER_ADDRESS ?? "",
  assetNFT: process.env.NEXT_PUBLIC_ASSET_NFT_ADDRESS ?? "",
} as const;

/* -------------------------------------------------------------------------- */
/* Role and permission identifiers                                             */
/* -------------------------------------------------------------------------- */

/**
 * Recomputed here rather than fetched. These are `keccak256` of a fixed string
 * in the contract, so deriving them locally cannot drift — and it saves a round
 * trip before every write.
 */
export const ROLE_HASH = {
  ADMIN: keccakUtf8("OWNEX_ROLE_ADMIN"),
  MANAGER: keccakUtf8("OWNEX_ROLE_MANAGER"),
  AUDITOR: keccakUtf8("OWNEX_ROLE_AUDITOR"),
  USER: keccakUtf8("OWNEX_ROLE_USER"),
} as const;

export type WritableRole = keyof typeof ROLE_HASH;

export const PERMISSION_HASH = {
  MANAGE_MEMBERS: keccakUtf8("PERM_MANAGE_MEMBERS"),
  ASSIGN_ROLES: keccakUtf8("PERM_ASSIGN_ROLES"),
  MINT_ASSETS: keccakUtf8("PERM_MINT_ASSETS"),
  TRANSFER_ASSETS: keccakUtf8("PERM_TRANSFER_ASSETS"),
  VIEW_AUDIT: keccakUtf8("PERM_VIEW_AUDIT"),
  MANAGE_APPS: keccakUtf8("PERM_MANAGE_APPS"),
} as const;

export type WritablePermission = keyof typeof PERMISSION_HASH;

/** `Override` enum, in the contract's declared order. */
export const OVERRIDE_VALUE = { Unset: 0, Allowed: 1, Denied: 2 } as const;

/** keccak256 of the slug — the on-chain application key. */
export function appIdFromSlug(slug: string): string {
  return keccakUtf8(slug);
}

/* -------------------------------------------------------------------------- */
/* ABI fragments — the complete write surface                                  */
/* -------------------------------------------------------------------------- */

export const IDENTITY_REGISTRY_ABI = [
  "function registerIdentity(bytes32 identityHash)",
  "function updateIdentityHash(bytes32 newHash)",
  "function createOrganization(bytes32 metadataHash) returns (uint256 orgId)",
  "event IdentityRegistered(address indexed wallet, bytes32 identityHash, address indexed registeredBy, uint64 at)",
  "event IdentityHashUpdated(address indexed wallet, bytes32 previousHash, bytes32 newHash, address indexed updatedBy)",
  "event OrganizationCreated(uint256 indexed orgId, address indexed rootAdmin, bytes32 metadataHash, uint64 at)",
  "error ZeroAddress()",
  "error EmptyHash()",
  "error IdentityAlreadyExists(address wallet)",
  "error IdentityNotFound(address wallet)",
  "error IdentityNotActive(address wallet)",
  "error IdentityAlreadyActive(address wallet)",
  "error NotAuthorizedRegistrar(address caller)",
  "error OrganizationNotFound(uint256 orgId)",
  "error NotOrgRootAdmin(uint256 orgId, address caller)",
] as const;

export const ORG_ACCESS_MANAGER_ABI = [
  "function addMember(uint256 orgId, address wallet, bytes32 role, uint64 expiresAt)",
  "function assignRole(uint256 orgId, address wallet, bytes32 role, uint64 expiresAt)",
  "function setRoleExpiry(uint256 orgId, address wallet, uint64 expiresAt)",
  "function removeMember(uint256 orgId, address wallet)",
  "function setPermission(uint256 orgId, bytes32 role, bytes32 permission, uint8 state)",
  "function registerApplication(uint256 orgId, bytes32 appId, bytes32 metadataHash)",
  "function setAppAccess(uint256 orgId, bytes32 appId, bytes32 role, bool allowed)",
  "event MemberAdded(uint256 indexed orgId, address indexed wallet, bytes32 role, uint64 expiresAt, address indexed by)",
  "event RoleAssigned(uint256 indexed orgId, address indexed wallet, bytes32 previousRole, bytes32 newRole, uint64 expiresAt, address indexed by)",
  "event ApplicationRegistered(uint256 indexed orgId, bytes32 indexed appId, bytes32 metadataHash, address indexed by)",
  "error ZeroAddress()",
  "error EmptyHash()",
  "error OrganizationNotFound(uint256 orgId)",
  "error OrganizationSuspended(uint256 orgId)",
  "error IdentityNotActive(address wallet)",
  "error InvalidRole(bytes32 role)",
  "error AlreadyMember(uint256 orgId, address wallet)",
  "error NotMember(uint256 orgId, address wallet)",
  "error MissingPermission(uint256 orgId, address caller, bytes32 permission)",
  "error CannotTargetSelf()",
  "error CannotModifyRootAdmin(uint256 orgId)",
  "error CannotDisableAdminGovernance()",
  "error ExpiryInPast(uint64 expiresAt)",
  "error ApplicationNotRegistered(uint256 orgId, bytes32 appId)",
  "error ApplicationAlreadyRegistered(uint256 orgId, bytes32 appId)",
] as const;

export const ASSET_NFT_ABI = [
  "function mintAsset(uint256 orgId, address assignedTo, bytes32 assetHash, string metadataURI) returns (uint256 tokenId)",
  "function reassignAsset(uint256 tokenId, address newHolder)",
  "function revokeAsset(uint256 tokenId)",
  "function restoreAsset(uint256 tokenId, address assignedTo)",
  "event AssetMinted(uint256 indexed tokenId, uint256 indexed orgId, address indexed assignedTo, bytes32 assetHash, string metadataURI, address by)",
  "error ZeroAddress()",
  "error EmptyHash()",
  "error EmptyURI()",
  "error UnknownAsset(uint256 tokenId)",
  "error AssetInactive(uint256 tokenId)",
  "error AssetAlreadyActive(uint256 tokenId)",
  "error MissingPermission(uint256 orgId, address caller, bytes32 permission)",
  "error RecipientNotOrgMember(uint256 orgId, address wallet)",
  "error TransfersLocked(uint256 tokenId)",
  "error AlreadyAssignedTo(address wallet)",
] as const;

/* -------------------------------------------------------------------------- */
/* Signer and contract construction                                            */
/* -------------------------------------------------------------------------- */

/**
 * A signer for the wallet the user picked.
 *
 * Takes the provider explicitly. With several wallets installed the one on
 * `window.ethereum` is whichever injected last, which is not necessarily the one
 * the user chose to sign in with.
 */
export async function getSigner(injected: unknown): Promise<Signer> {
  const provider = new BrowserProvider(injected as EthersEip1193Provider);
  return provider.getSigner();
}

export function identityRegistry(signer: Signer): Contract {
  return new Contract(ADDRESSES.identityRegistry, IDENTITY_REGISTRY_ABI, signer);
}

export function orgAccessManager(signer: Signer): Contract {
  return new Contract(ADDRESSES.orgAccessManager, ORG_ACCESS_MANAGER_ABI, signer);
}

export function assetNFT(signer: Signer): Contract {
  return new Contract(ADDRESSES.assetNFT, ASSET_NFT_ABI, signer);
}

/** Unix seconds for a `yyyy-mm-dd` value, or 0 for permanent. */
export function expiryToUnix(date: string): number {
  if (!date) return 0;
  const parsed = new Date(`${date}T23:59:59`);
  const seconds = Math.floor(parsed.getTime() / 1000);
  return Number.isFinite(seconds) ? seconds : 0;
}
