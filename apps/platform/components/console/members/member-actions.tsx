"use client";

import * as React from "react";

import type { OrgMember } from "@/lib/api";
import { shortAddress } from "@/lib/wallet";
import { useToday } from "@/lib/use-today";
import {
  ROLE_HASH,
  expiryToUnix,
  orgAccessManager,
  type WritableRole,
} from "@/lib/contracts";
import {
  Badge,
  Button,
  Input,
  Modal,
  RoleChip,
  Select,
  type Role,
} from "@/components/ui";
import { useTransaction } from "@/components/console/tx/use-transaction";
import {
  TransactionDismissed,
  TransactionFailure,
  TransactionRail,
} from "@/components/console/tx/transaction-rail";

/**
 * The three member writes.
 *
 * All on-chain and nothing else: a role is a storage entry in the contract, so
 * unlike minting there is no off-chain half to save first and no confirmation
 * step afterwards. That makes these the simplest possible use of the transaction
 * rail, which is why the guards get the space instead.
 *
 * Each modal states the rule that would reject it before the user tries — self
 * targeting, the root admin's seat, an expiry in the past. The contract enforces
 * all three regardless; saying so up front means the refusal is not a surprise,
 * and if one arrives anyway it is decoded by name rather than shown as "execution
 * reverted".
 */

const ROLE_OPTIONS: Array<{ value: WritableRole; label: string }> = [
  { value: "ADMIN", label: "Admin — everything, including roles and minting" },
  { value: "MANAGER", label: "Manager — move assets, read audit" },
  { value: "AUDITOR", label: "Auditor — read audit only" },
  { value: "USER", label: "User — no administrative permission" },
];

function GuardNote({ call, permission, guards }: { call: string; permission: string; guards: string[] }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <p className="label-xs mb-2 text-ink-faint">What this sends</p>
      <code className="block font-mono text-[0.6875rem] break-all text-ink">{call}</code>
      <p className="mt-2 text-xs text-ink-muted">
        Needs <code className="font-mono text-ink">{permission}</code>, checked
        against the contract at the moment the transaction runs — not against
        anything this page believes.
      </p>
      <ul className="mt-2 flex list-disc flex-col gap-1 ps-4 text-xs text-ink-muted">
        {guards.map((guard) => (
          <li key={guard}>{guard}</li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Add a member                                                                */
/* -------------------------------------------------------------------------- */

export function AddMemberModal({
  open,
  onClose,
  orgId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  orgId: number;
  onDone: () => void;
}) {
  const [wallet, setWallet] = React.useState("");
  const [role, setRole] = React.useState<WritableRole>("USER");
  const [expiry, setExpiry] = React.useState("");
  const tx = useTransaction();
  const today = useToday();

  const walletValid = /^0x[a-fA-F0-9]{40}$/.test(wallet.trim());
  const expiryUnix = expiryToUnix(expiry);
  // A plain string comparison, because both sides are `yyyy-mm-dd`. Reading the
  // clock during render is impure and the lint rule rejects it.
  const expiryFuture = expiry === "" || expiry > today;

  const close = () => {
    if (tx.busy) return;
    // The roster is stale the moment this lands, so the parent reloads as the
    // dialog closes rather than on a timer the user cannot see.
    if (tx.stage === "done") onDone();
    onClose();
    setWallet("");
    setExpiry("");
    setRole("USER");
    tx.reset();
  };

  const submit = () =>
    tx.run({
      send: ({ signer }) =>
        orgAccessManager(signer).addMember(
          orgId,
          wallet.trim(),
          ROLE_HASH[role],
          expiryUnix,
        ),
    });

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a member"
      description="Membership is granted to a wallet address. There is no invite email, because there is no account to invite."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={tx.busy}>
            {tx.stage === "done" ? "Close" : "Cancel"}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={tx.busy}
            disabled={!walletValid || !expiryFuture || tx.stage === "done"}
          >
            {tx.stage === "error" ? "Try again" : "Sign and add"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Wallet address"
          placeholder="0x…"
          mono
          value={wallet}
          onChange={(event) => setWallet(event.target.value)}
          disabled={tx.busy || tx.stage === "done"}
          error={wallet && !walletValid ? "Needs to be a full 0x address" : undefined}
          hint={
            walletValid || !wallet
              ? "The wallet must already hold an active identity; the contract rejects it otherwise."
              : undefined
          }
        />
        <Select
          label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value as WritableRole)}
          disabled={tx.busy || tx.stage === "done"}
          options={ROLE_OPTIONS}
        />
        <Input
          label="Access expires"
          type="date"
          min={today || undefined}
          value={expiry}
          onChange={(event) => setExpiry(event.target.value)}
          disabled={tx.busy || tx.stage === "done"}
          error={expiryFuture ? undefined : "That date has already passed"}
          hint="Leave empty for permanent access. A date makes the role lapse on its own, with no transaction needed on the day."
        />

        <p className="flex items-center gap-2">
          <span className="label-xs text-ink-faint">Preview</span>
          <RoleChip
            role={role as Role}
            expiresAt={expiry ? new Date(expiry).toLocaleDateString() : undefined}
          />
        </p>

        <TransactionFailure failure={tx.failure} />
        <TransactionRail stage={tx.stage} txHash={tx.txHash} />
        <TransactionDismissed failure={tx.failure} />

        {tx.stage === "idle" || tx.stage === "error" ? (
          <GuardNote
            call={`OrgAccessManager.addMember(${orgId}, ${walletValid ? shortAddress(wallet.trim()) : "<wallet>"}, ROLE_${role}, ${expiryUnix})`}
            permission="MANAGE_MEMBERS"
            guards={[
              "Rejects a wallet with no active identity.",
              "Rejects a wallet that is already a member.",
              "Rejects an expiry date in the past.",
            ]}
          />
        ) : null}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Change a role                                                               */
/* -------------------------------------------------------------------------- */

export function ChangeRoleModal({
  member,
  onClose,
  orgId,
  onDone,
}: {
  member: OrgMember | null;
  onClose: () => void;
  orgId: number;
  onDone: () => void;
}) {
  const [role, setRole] = React.useState<WritableRole>("USER");
  const [expiry, setExpiry] = React.useState("");
  const tx = useTransaction();
  const today = useToday();

  // The stored role is the honest starting point, because that is what the
  // transaction would replace. The root admin has no stored record — the seat
  // comes from creating the organisation — so fall back to what applies today.
  const current =
    member === null
      ? "USER"
      : member.storedRole !== "NONE"
        ? member.storedRole
        : member.role;
  const lapsed =
    member !== null && member.storedRole !== "NONE" && member.role !== member.storedRole;

  const expiryUnix = expiryToUnix(expiry);
  const expiryFuture = expiry === "" || expiry > today;

  const close = () => {
    if (tx.busy) return;
    if (tx.stage === "done") onDone();
    onClose();
    setExpiry("");
    tx.reset();
  };

  const submit = () => {
    if (!member) return;
    tx.run({
      send: ({ signer }) =>
        orgAccessManager(signer).assignRole(
          orgId,
          member.wallet,
          ROLE_HASH[role],
          expiryUnix,
        ),
    });
  };

  return (
    <Modal
      open={member !== null}
      onClose={close}
      title={member ? `Change role for ${shortAddress(member.wallet)}` : "Change role"}
      description="Roles are storage entries, never tokens. Nothing here can be sold or transferred to somebody else."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={tx.busy}>
            {tx.stage === "done" ? "Close" : "Cancel"}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={tx.busy}
            disabled={
              !member ||
              member.isRootAdmin ||
              !expiryFuture ||
              tx.stage === "done" ||
              (role === current && !expiry)
            }
          >
            {tx.stage === "error" ? "Try again" : "Sign and change"}
          </Button>
        </>
      }
    >
      {member ? (
        <div className="flex flex-col gap-4">
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span className="label-xs text-ink-faint">Currently</span>
            <RoleChip role={current as Role} />
            {lapsed ? (
              <Badge tone="warn">Lapsed, so it resolves to {member.role} today</Badge>
            ) : null}
          </p>

          {member.isRootAdmin ? (
            <p
              role="alert"
              className="rounded-md border border-danger/45 bg-danger/10 p-3 text-xs leading-relaxed text-ink"
            >
              This wallet is the organisation&apos;s root admin, and{" "}
              <code className="font-mono">assignRole</code> reverts with{" "}
              <code className="font-mono">CannotModifyRootAdmin</code> for it. The
              seat moves only through{" "}
              <code className="font-mono">IdentityRegistry.transferOrgRootAdmin</code>
              , which is what stops an organisation being orphaned.
            </p>
          ) : (
            <>
              <Select
                label="New role"
                value={role}
                onChange={(event) => setRole(event.target.value as WritableRole)}
                disabled={tx.busy || tx.stage === "done"}
                options={ROLE_OPTIONS}
              />
              <Input
                label="Access expires"
                type="date"
                min={today || undefined}
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
                disabled={tx.busy || tx.stage === "done"}
                error={expiryFuture ? undefined : "That date has already passed"}
                hint="Empty means permanent. Setting a date here also replaces any existing expiry."
              />

              <TransactionFailure failure={tx.failure} />
              <TransactionRail stage={tx.stage} txHash={tx.txHash} />
              <TransactionDismissed failure={tx.failure} />

              {tx.stage === "idle" || tx.stage === "error" ? (
                <GuardNote
                  call={`OrgAccessManager.assignRole(${orgId}, ${shortAddress(member.wallet)}, ROLE_${role}, ${expiryUnix})`}
                  permission="ASSIGN_ROLES"
                  guards={[
                    "Reverts with CannotTargetSelf if you aim it at your own membership — nobody promotes themselves, including a full admin.",
                    "Reverts with CannotModifyRootAdmin for the root admin's seat.",
                    "Reverts if the target wallet's identity is not active.",
                  ]}
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Remove a member                                                             */
/* -------------------------------------------------------------------------- */

export function RemoveMemberModal({
  member,
  onClose,
  orgId,
  onDone,
}: {
  member: OrgMember | null;
  onClose: () => void;
  orgId: number;
  onDone: () => void;
}) {
  const tx = useTransaction();

  const close = () => {
    if (tx.busy) return;
    if (tx.stage === "done") onDone();
    onClose();
    tx.reset();
  };

  const submit = () => {
    if (!member) return;
    tx.run({
      send: ({ signer }) => orgAccessManager(signer).removeMember(orgId, member.wallet),
    });
  };

  return (
    <Modal
      open={member !== null}
      onClose={close}
      title="Remove this member"
      description="Their role ends immediately. Certificates they hold do not move on their own."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={tx.busy}>
            {tx.stage === "done" ? "Close" : "Cancel"}
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            loading={tx.busy}
            disabled={!member || member.isRootAdmin || tx.stage === "done"}
          >
            {tx.stage === "error" ? "Try again" : "Sign and remove"}
          </Button>
        </>
      }
    >
      {member ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-ink-muted">
            Removing{" "}
            <span className="font-mono text-ink">{shortAddress(member.wallet)}</span>{" "}
            ends every permission they hold here in the same block. Their identity
            is untouched — this is membership of one organisation, not the wallet
            itself.
          </p>

          {member.assetCount > 0 ? (
            <p
              role="alert"
              className="rounded-md border border-warn/45 bg-warn/10 p-3 text-xs leading-relaxed text-ink"
            >
              They still hold {member.assetCount}{" "}
              {member.assetCount === 1 ? "certificate" : "certificates"}. Removing
              the membership does not reclaim them, and{" "}
              <code className="font-mono">verifyOwnership</code> will start failing
              for those tokens because the holder is no longer a member. Revoke or
              reassign them first if the equipment is coming back.
            </p>
          ) : null}

          {member.isRootAdmin ? (
            <p
              role="alert"
              className="rounded-md border border-danger/45 bg-danger/10 p-3 text-xs leading-relaxed text-ink"
            >
              The root admin cannot be removed. An organisation with no admin
              could never be governed again, so the contract refuses.
            </p>
          ) : (
            <>
              <TransactionFailure failure={tx.failure} />
              <TransactionRail stage={tx.stage} txHash={tx.txHash} />
              <TransactionDismissed failure={tx.failure} />

              {tx.stage === "idle" || tx.stage === "error" ? (
                <GuardNote
                  call={`OrgAccessManager.removeMember(${orgId}, ${shortAddress(member.wallet)})`}
                  permission="MANAGE_MEMBERS"
                  guards={[
                    "Reverts with CannotTargetSelf for your own membership.",
                    "Reverts with CannotModifyRootAdmin for the root admin.",
                    "Enumeration stays consistent: the contract swaps and pops.",
                  ]}
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
