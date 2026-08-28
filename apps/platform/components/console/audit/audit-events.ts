import type { AuditContract } from "@/lib/api";

/**
 * The 21 events the indexer tracks, in plain words.
 *
 * The raw event name is always shown too. It is what a verifier greps for in the
 * chain, so translating it away would make the trail harder to check rather than
 * easier — the sentence is there for the reader, the identifier for the auditor.
 *
 * Keep this list in step with `TRACKED` in `lib/indexer.ts`.
 */
export const AUDIT_EVENTS: Array<{
  name: string;
  contract: AuditContract;
  says: string;
}> = [
  // ── IdentityRegistry ────────────────────────────────────────────────
  {
    name: "IdentityRegistered",
    contract: "IdentityRegistry",
    says: "A wallet anchored an identity record.",
  },
  {
    name: "IdentityHashUpdated",
    contract: "IdentityRegistry",
    says: "An identity record changed, and the new anchor was written.",
  },
  {
    name: "IdentityRevoked",
    contract: "IdentityRegistry",
    says: "An identity was switched off. Every role behind it died with it.",
  },
  {
    name: "IdentityReactivated",
    contract: "IdentityRegistry",
    says: "A registrar brought a revoked identity back.",
  },
  {
    name: "RegistrarUpdated",
    contract: "IdentityRegistry",
    says: "The platform owner granted or withdrew registrar rights.",
  },
  {
    name: "OrganizationCreated",
    contract: "IdentityRegistry",
    says: "An organisation was created, and its creator became root admin.",
  },
  {
    name: "OrganizationMetadataUpdated",
    contract: "IdentityRegistry",
    says: "The organisation's off-chain record changed, and its anchor with it.",
  },
  {
    name: "OrganizationStatusChanged",
    contract: "IdentityRegistry",
    says: "An organisation was suspended or reinstated, freezing or thawing every permission inside it.",
  },
  {
    name: "OrgRootAdminTransferred",
    contract: "IdentityRegistry",
    says: "Root administration of the organisation moved to another wallet.",
  },

  // ── OrgAccessManager ────────────────────────────────────────────────
  {
    name: "MemberAdded",
    contract: "OrgAccessManager",
    says: "A wallet was added to the organisation with a role.",
  },
  {
    name: "MemberRemoved",
    contract: "OrgAccessManager",
    says: "A wallet was removed from the organisation.",
  },
  {
    name: "RoleAssigned",
    contract: "OrgAccessManager",
    says: "A member's role changed. Nobody can do this to themselves.",
  },
  {
    name: "RoleExpiryUpdated",
    contract: "OrgAccessManager",
    says: "A time-bound role had its deadline moved.",
  },
  {
    name: "PermissionUpdated",
    contract: "OrgAccessManager",
    says: "A permission was allowed, denied, or returned to the default for a role.",
  },
  {
    name: "ApplicationRegistered",
    contract: "OrgAccessManager",
    says: "An application was registered for single sign-on.",
  },
  {
    name: "AppAccessChanged",
    contract: "OrgAccessManager",
    says: "A role gained or lost access to an application.",
  },

  // ── AssetNFT ────────────────────────────────────────────────────────
  {
    name: "AssetMinted",
    contract: "AssetNFT",
    says: "A certificate was minted and assigned to a holder.",
  },
  {
    name: "AssetAssigned",
    contract: "AssetNFT",
    says: "Custody moved to another holder, under organisation control.",
  },
  {
    name: "AssetRevoked",
    contract: "AssetNFT",
    says: "A certificate was withdrawn; custody returned to the root admin.",
  },
  {
    name: "AssetRestored",
    contract: "AssetNFT",
    says: "A revoked certificate was reissued to a holder.",
  },
  {
    name: "AssetMetadataUpdated",
    contract: "AssetNFT",
    says: "The certificate's record changed, and its anchor was rewritten.",
  },
];

const BY_NAME = new Map(AUDIT_EVENTS.map((e) => [e.name, e]));

export function describeEvent(name: string): string {
  return BY_NAME.get(name)?.says ?? "An event was recorded on the chain.";
}

/** "AssetMinted" → "Asset minted". */
export function humaniseEvent(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Which side of the ledger an event sits on. Used only to pick a tone, so a
 * scan of the timeline separates routine grants from withdrawals.
 */
export function eventSeverity(name: string): "neutral" | "grant" | "withdraw" {
  if (/Revoked|Removed/.test(name)) return "withdraw";
  if (/Registered|Added|Minted|Created|Restored|Reactivated|Assigned/.test(name)) {
    return "grant";
  }
  return "neutral";
}
