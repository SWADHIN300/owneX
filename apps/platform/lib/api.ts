/**
 * Typed client for the owneX API.
 *
 * The session is an httpOnly cookie set by the server, so every call sends
 * credentials and none of them take a token. A 401 means "not signed in" and is
 * returned rather than thrown, because for `getMe` that is an ordinary state, not
 * an error.
 */

export interface ApiErrorShape {
  status: number;
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor({ status, code, message }: ApiErrorShape) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string; code?: string; message?: string };
    throw new ApiRequestError({
      status: response.status,
      code: body.code ?? "REQUEST_FAILED",
      message: body.error ?? body.message ?? `Request failed with ${response.status}`,
    });
  }

  return payload as T;
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export interface Challenge {
  nonce: string;
  message: string;
  expiresAt: string;
  gasRequired: boolean;
}

export function requestChallenge(wallet: string): Promise<Challenge> {
  return request<Challenge>("/api/auth/nonce", {
    method: "POST",
    body: JSON.stringify({ wallet }),
  });
}

export interface Membership {
  orgId: number;
  role: string;
  expiresAt: number | null;
}

export interface VerifyResult {
  wallet: string;
  identity: { registered: boolean; active: boolean; identityHash: string | null };
  memberships: Membership[];
  profile: { display_name?: string | null } | null;
  /** Where the client should route next. */
  next: "onboarding" | "no-organization" | "dashboard";
}

export function verifySignature(message: string, signature: string): Promise<VerifyResult> {
  return request<VerifyResult>("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ message, signature }),
  });
}

export function signOut(): Promise<unknown> {
  return request("/api/auth/logout", { method: "POST" });
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export interface Me {
  wallet: string;
  identity: {
    registered: boolean;
    active: boolean;
    identityHash: string | null;
    registeredAt: number | null;
    did: string;
    /** Null when either side has no hash to compare. */
    recordIntact: boolean | null;
  };
  profile: {
    displayName: string | null;
    jobTitle: string | null;
    department: string | null;
    avatarUrl: string | null;
    email: string | null;
    emailMasked: string | null;
  } | null;
  activeOrgId: number | null;
  memberships: Membership[];
  permissions: string[] | null;
  assets: number[];
}

/**
 * Current user, or `null` when there is no valid session. A 401 here is the
 * ordinary signed-out state, so it is not treated as a failure.
 */
export async function getMe(orgId?: number): Promise<Me | null> {
  const query = orgId !== undefined ? `?orgId=${orgId}` : "";
  try {
    return await request<Me>(`/api/identity/me${query}`);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Assets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One asset certificate, as the vault sees it.
 *
 * The field order mirrors the route: chain facts first, because they are
 * authoritative, then the display detail that comes from Supabase. Anything
 * nullable is nullable because the two halves can genuinely disagree — an asset
 * minted directly against the contract has no off-chain row at all.
 */
export interface AssetSummary {
  tokenId: number;
  orgId: number;
  owner: string;
  assignedTo: string;
  active: boolean;
  /** Unix seconds. */
  mintedAt: number;
  transferCount: number;
  assetHash: string;

  name: string;
  description: string | null;
  assetType: string;
  department: string | null;
  imageUrl: string | null;
  metadataUri: string | null;
  /** Masked to the last few characters unless the caller is ADMIN or MANAGER. */
  serialNumber: string | null;

  /** `null` when there is no off-chain record to compare against. */
  recordIntact: boolean | null;
  hasOffChainRecord: boolean;
}

/** A draft that was created but never bound to a minted token. */
export interface AssetDraft {
  id: string;
  name: string;
  assetType: string;
  assetHash: string;
  metadataUri: string | null;
  createdAt: string;
}

export interface AssetList {
  orgId: number;
  count: number;
  assets: AssetSummary[];
  pending: AssetDraft[];
}

export function listAssets(orgId: number): Promise<AssetList> {
  return request<AssetList>(`/api/assets?orgId=${orgId}`);
}

/** Public ERC-721 metadata. No authentication, and no confidential fields. */
export interface AssetMetadata {
  name: string;
  description: string;
  image: string | null;
  external_url: string | null;
  attributes: Array<{ trait_type: string; value: string | number }>;
  asset_hash: string;
  ownex: {
    tokenId: number | null;
    orgId: number;
    holder: string | null;
    active: boolean | null;
    schema: string;
  };
}

export function getAssetMetadata(tokenId: number): Promise<AssetMetadata> {
  return request<AssetMetadata>(`/api/metadata/${tokenId}`);
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

export type AuditContract = "IdentityRegistry" | "OrgAccessManager" | "AssetNFT";

export interface AuditEvent {
  id: string;
  contract: AuditContract;
  event: string;
  orgId: number | null;
  actor: string | null;
  subject: string | null;
  tokenId: number | null;
  txHash: string;
  blockNumber: number;
  payload: Record<string, unknown> | null;
  /** Null unless NEXT_PUBLIC_EXPLORER_URL is configured. */
  explorerUrl: string | null;
}

export interface AuditPage {
  orgId: number;
  count: number;
  hasMore: boolean;
  nextCursor: number | null;
  events: AuditEvent[];
}

export interface AuditQuery {
  orgId: number;
  event?: string;
  wallet?: string;
  tokenId?: number;
  contract?: AuditContract;
  limit?: number;
  /** Block number to page back from. */
  cursor?: number;
}

export function getAudit(query: AuditQuery): Promise<AuditPage> {
  const params = new URLSearchParams({ orgId: String(query.orgId) });
  if (query.event) params.set("event", query.event);
  if (query.wallet) params.set("wallet", query.wallet);
  if (query.tokenId !== undefined) params.set("tokenId", String(query.tokenId));
  if (query.contract) params.set("contract", query.contract);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor !== undefined) params.set("cursor", String(query.cursor));
  return request<AuditPage>(`/api/audit?${params.toString()}`);
}

export interface SyncResult {
  chainId: number;
  fromBlock: number;
  toBlock: number;
  indexed: number;
  perContract: Record<string, number>;
  resetDetected: boolean;
}

/** Pulls contract events into the audit cache. Idempotent. */
export function syncAudit(): Promise<SyncResult> {
  return request<SyncResult>("/api/audit/sync", { method: "POST", body: "{}" });
}

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

export interface OrgMember {
  wallet: string;
  /** The role that applies right now, not the stored one. */
  role: string;
  /** What the membership record holds, which can differ once it has lapsed. */
  storedRole: string;
  joinedAt: number | null;
  expiresAt: number | null;
  expired: boolean;
  isRootAdmin: boolean;
  identity: { registered: boolean; active: boolean };
  profile: { displayName: string | null; jobTitle: string | null; department: string | null } | null;
  assetCount: number;
}

export interface MemberList {
  orgId: number;
  organisation: { name: string | null; rootAdmin: string; active: boolean } | null;
  count: number;
  /** True when the caller may see names and departments. */
  canSeeProfiles: boolean;
  members: OrgMember[];
}

export function listMembers(orgId: number): Promise<MemberList> {
  return request<MemberList>(`/api/members?orgId=${orgId}`);
}

/* -------------------------------------------------------------------------- */
/* Roles and permissions                                                      */
/* -------------------------------------------------------------------------- */

export type OverrideState = "Unset" | "Allowed" | "Denied";

export interface MatrixCell {
  role: string;
  permission: string;
  /** What the contract's zero-config baseline says. */
  default: boolean;
  /** What this organisation set, if anything. */
  override: OverrideState;
  /** What `hasPermission` actually returns today. */
  effective: boolean;
}

export interface PermissionMatrix {
  orgId: number;
  organisationActive: boolean;
  roles: string[];
  permissions: Array<{ key: string; label: string }>;
  cells: MatrixCell[];
  /** True when the caller may change cells. Writes are not wired yet. */
  canEdit: boolean;
}

export function getPermissionMatrix(orgId: number): Promise<PermissionMatrix> {
  return request<PermissionMatrix>(`/api/roles/matrix?orgId=${orgId}`);
}

/* -------------------------------------------------------------------------- */
/* Health                                                                      */
/* -------------------------------------------------------------------------- */

export interface Health {
  ok: boolean;
  chainId?: number;
  [key: string]: unknown;
}

export function getHealth(): Promise<Health> {
  return request<Health>("/api/health");
}
