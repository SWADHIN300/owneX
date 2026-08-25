import { id as keccakUtf8 } from "ethers";

/**
 * Canonical hashing — the bridge between private off-chain data and public
 * on-chain proof.
 *
 * The rule: hash the record, store the hash on-chain, keep the record encrypted
 * in the database. Later, re-hash the record and compare. A match proves the
 * record is unmodified; a mismatch proves somebody edited it. Nothing private
 * is ever published.
 *
 * Canonicalisation matters. `{a:1,b:2}` and `{b:2,a:1}` are the same record but
 * different strings, and would hash differently. Keys are therefore sorted
 * recursively and undefined values dropped, so the same logical record always
 * produces the same hash.
 */

const ASSET_DOMAIN = "ownex:asset:v1";
const IDENTITY_DOMAIN = "ownex:identity:v1";
const ORGANIZATION_DOMAIN = "ownex:organization:v1";
const APPLICATION_DOMAIN = "ownex:application:v1";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };

export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;

  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();

  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as Json)}`).join(",")}}`;
}

function domainHash(domain: string, payload: Json): string {
  return keccakUtf8(`${domain}:${canonicalJson(payload)}`);
}

export type AssetRecord = {
  orgId: number;
  name: string;
  assetType: string;
  serialNumber?: string | null;
  invoiceReference?: string | null;
  department?: string | null;
};

/** The anchor stored in AssetNFT.assetHash. */
export function hashAssetRecord(record: AssetRecord): string {
  return domainHash(ASSET_DOMAIN, {
    orgId: record.orgId,
    name: record.name.trim(),
    assetType: record.assetType.trim(),
    serialNumber: record.serialNumber?.trim() ?? null,
    invoiceReference: record.invoiceReference?.trim() ?? null,
    department: record.department?.trim() ?? null,
  });
}

export type IdentityRecord = {
  displayName: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  department?: string | null;
};

/** The anchor stored in IdentityRegistry.identityHash. */
export function hashIdentityRecord(record: IdentityRecord): string {
  return domainHash(IDENTITY_DOMAIN, {
    displayName: record.displayName.trim(),
    email: record.email?.trim().toLowerCase() ?? null,
    phone: record.phone?.trim() ?? null,
    jobTitle: record.jobTitle?.trim() ?? null,
    department: record.department?.trim() ?? null,
  });
}

export type OrganizationRecord = {
  name: string;
  industry?: string | null;
  website?: string | null;
};

export function hashOrganizationRecord(record: OrganizationRecord): string {
  return domainHash(ORGANIZATION_DOMAIN, {
    name: record.name.trim(),
    industry: record.industry?.trim() ?? null,
    website: record.website?.trim() ?? null,
  });
}

export type ApplicationRecord = {
  slug: string;
  name: string;
  url: string;
};

export function hashApplicationRecord(record: ApplicationRecord): string {
  return domainHash(APPLICATION_DOMAIN, {
    slug: record.slug.trim(),
    name: record.name.trim(),
    url: record.url.trim(),
  });
}
