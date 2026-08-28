/**
 * Turning a revert into a sentence.
 *
 * A contract that rejects a transaction has already said exactly why — the
 * custom error name is the reason, and it is more precise than anything an
 * interface could infer. Left undecoded it reaches the user as "execution
 * reverted", which is the single least useful error message in this domain: it
 * covers "you lack permission", "that wallet is already a member" and "you
 * cannot promote yourself" without distinguishing them.
 *
 * Because `lib/contracts.ts` includes the error fragments, ethers decodes the
 * name and arguments for us. This maps them to what the user should do next.
 *
 * Anything not listed falls through to the raw name rather than a generic
 * message, because a name I have not translated is still a real clue.
 */

import { shortAddress } from "./wallet";

/** Reverts that mean "you did something the contract deliberately forbids". */
const EXPLANATIONS: Record<string, (args: readonly unknown[]) => string> = {
  /* ── shared ─────────────────────────────────────────────────────── */
  MissingPermission: () =>
    "Your role in this organisation does not carry the permission this needs. The contract checks it at the moment the transaction runs, so a role change made seconds ago counts.",
  ZeroAddress: () => "That address is empty. A wallet address is required here.",
  EmptyHash: () => "The record hash was empty, so there would be nothing to anchor.",
  EmptyURI: () => "The metadata URI was empty. The certificate needs somewhere to point.",
  IdentityNotActive: (args) =>
    `${label(args[0])} has no active identity. A wallet must hold a live identity before it can be given a role or an asset — which is what stops a roster filling up with addresses nobody controls.`,
  OrganizationSuspended: () =>
    "This organisation is suspended, which freezes every permission inside it. Nothing can be changed until it is reinstated.",
  OrganizationNotFound: () => "That organisation does not exist on this chain.",

  /* ── OrgAccessManager ───────────────────────────────────────────── */
  AlreadyMember: (args) =>
    `${label(args[1])} is already a member of this organisation. Change their role instead of adding them again.`,
  NotMember: (args) =>
    `${label(args[1])} is not a member of this organisation, so there is no role to change.`,
  CannotTargetSelf: () =>
    "You cannot aim this at your own membership. Nobody promotes or removes themselves here, including a full admin — that is what makes a role something granted rather than taken.",
  CannotModifyRootAdmin: () =>
    "That wallet is the organisation's root admin, and its seat cannot be altered here. It moves only through transferOrgRootAdmin, which is what stops an organisation being orphaned.",
  CannotDisableAdminGovernance: () =>
    "An organisation cannot deny Admin the ability to manage members or assign roles. Allowing it would let one override lock the organisation out of its own governance with no way back.",
  InvalidRole: () => "That is not one of the four roles this contract recognises.",
  ExpiryInPast: () =>
    "The expiry date has already passed. Access that lapses the moment it is granted is almost certainly not what was meant.",
  ApplicationAlreadyRegistered: () =>
    "An application with that slug is already registered for this organisation.",
  ApplicationNotRegistered: () =>
    "No application with that slug is registered for this organisation yet.",

  /* ── IdentityRegistry ───────────────────────────────────────────── */
  IdentityAlreadyExists: () =>
    "This wallet already has an identity on this chain. Update its record instead of registering again.",
  IdentityNotFound: () => "This wallet has no identity registered yet.",
  IdentityAlreadyActive: () => "That identity is already active.",
  NotAuthorizedRegistrar: () =>
    "Only a registrar may do that. Registering yourself is always allowed; registering somebody else is not.",
  NotOrgRootAdmin: () => "Only the organisation's root admin may do that.",

  /* ── AssetNFT ───────────────────────────────────────────────────── */
  TransfersLocked: () =>
    "These certificates cannot be transferred wallet-to-wallet. That is deliberate: a company laptop is not a collectible, so only the organisation's permission-gated functions can move one.",
  RecipientNotOrgMember: (args) =>
    `${label(args[1])} is not a member of this organisation, so a certificate cannot be assigned to them.`,
  UnknownAsset: () => "There is no certificate with that token id.",
  AssetInactive: () => "That certificate has been revoked, so this cannot be done to it.",
  AssetAlreadyActive: () => "That certificate is already active.",
  AlreadyAssignedTo: (args) => `That certificate is already held by ${label(args[0])}.`,
};

function label(value: unknown): string {
  const text = String(value ?? "");
  return /^0x[a-fA-F0-9]{40}$/.test(text) ? shortAddress(text) : text;
}

/**
 * What ethers gives us when a call reverts. Typed loosely on purpose: the shape
 * varies between a revert, a gas estimation failure and a provider-level error,
 * and narrowing it precisely would mean asserting a shape ethers does not
 * guarantee.
 */
interface MaybeRevert {
  code?: string;
  shortMessage?: string;
  reason?: string | null;
  revert?: { name?: string; args?: readonly unknown[] } | null;
  info?: { error?: { message?: string; code?: number } };
  error?: { message?: string; code?: number };
  message?: string;
}

export interface DecodedFailure {
  /** One sentence, written for the person who pressed the button. */
  message: string;
  /** The contract's own error name, when there was one. Worth showing verbatim. */
  errorName?: string;
  /** True when the user dismissed the wallet prompt — not really a failure. */
  rejected: boolean;
}

const USER_REJECTED = 4001;

/**
 * A revert is the contract enforcing a rule, and the rule is the interesting
 * part. A rejection in the wallet is the user changing their mind, and needs no
 * alarm at all.
 */
export function decodeFailure(error: unknown): DecodedFailure {
  const err = (error ?? {}) as MaybeRevert;

  const code = (err.info?.error?.code ?? err.error?.code) as number | undefined;
  if (err.code === "ACTION_REJECTED" || code === USER_REJECTED) {
    return { message: "You dismissed the request in your wallet. Nothing was sent.", rejected: true };
  }

  const name = err.revert?.name;
  if (name) {
    const explain = EXPLANATIONS[name];
    return {
      message: explain
        ? explain(err.revert?.args ?? [])
        : `The contract refused this with ${name}.`,
      errorName: name,
      rejected: false,
    };
  }

  if (err.code === "INSUFFICIENT_FUNDS") {
    return {
      message:
        "This wallet has no funds for gas on this network. On the local chain, import one of the funded Hardhat accounts.",
      rejected: false,
    };
  }

  if (err.code === "NETWORK_ERROR" || err.code === "SERVER_ERROR") {
    return {
      message:
        "The wallet could not reach the network. Check that the chain is running and that the wallet points at it.",
      rejected: false,
    };
  }

  // A revert with no decoded name usually means the estimate failed before the
  // wallet ever opened. The nested provider message is the most specific thing
  // available, so it is preferred over the generic ethers wrapper.
  const nested = err.info?.error?.message ?? err.error?.message;
  const fallback = nested ?? err.shortMessage ?? err.reason ?? err.message;

  return {
    message: fallback
      ? String(fallback).split("\n")[0].slice(0, 220)
      : "The transaction could not be completed.",
    rejected: false,
  };
}
