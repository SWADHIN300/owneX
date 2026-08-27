"use client";

import * as React from "react";

import type { OrgMember } from "@/lib/api";
import { shortAddress } from "@/lib/wallet";
import {
  Badge,
  Button,
  Input,
  Modal,
  RoleChip,
  Select,
  type Role,
} from "@/components/ui";

/**
 * The two write actions this screen needs, designed but not wired.
 *
 * Both are new surface area: a signed transaction sent from the user's wallet,
 * plus an endpoint to record the off-chain half. That is a bigger change than a
 * read screen and it is not being switched on quietly, so the forms are here in
 * full — with the exact contract call, the permission it needs and the guards
 * that will reject it — and the submit is inert until the write path is agreed.
 *
 * A disabled button with a stated reason is more useful than a hidden one: it
 * shows an admin what the flow will be, and it cannot mislead anybody into
 * thinking a change was saved.
 */

const PENDING_NOTE =
  "Not wired yet. Writing this needs a transaction signed in your wallet, and that path is being reviewed before it is switched on.";

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin — everything, including roles and minting" },
  { value: "MANAGER", label: "Manager — move assets, read audit" },
  { value: "AUDITOR", label: "Auditor — read audit only" },
  { value: "USER", label: "User — no administrative permission" },
];

function ContractNote({
  call,
  permission,
  guards,
}: {
  call: string;
  permission: string;
  guards: string[];
}) {
  return (
    <div className="mt-5 rounded-md border border-border bg-surface-2 p-3">
      <p className="label-xs mb-2 text-ink-faint">What this will do</p>
      <code className="block font-mono text-[0.6875rem] break-all text-ink">
        {call}
      </code>
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

export function AddMemberModal({
  open,
  onClose,
  orgId,
}: {
  open: boolean;
  onClose: () => void;
  orgId: number;
}) {
  const [wallet, setWallet] = React.useState("");
  const [role, setRole] = React.useState("USER");
  const [expiry, setExpiry] = React.useState("");

  const walletValid = wallet === "" || /^0x[a-fA-F0-9]{40}$/.test(wallet.trim());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a member"
      description="Membership is granted to a wallet address. There is no invite email, because there is no account to invite."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" disabled title={PENDING_NOTE}>
            Sign and add
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
          error={walletValid ? undefined : "Needs to be a full 0x address"}
          hint={
            walletValid
              ? "The wallet must already hold an active identity; the contract rejects it otherwise."
              : undefined
          }
        />
        <Select
          label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          options={ROLE_OPTIONS}
        />
        <Input
          label="Access expires"
          type="date"
          value={expiry}
          onChange={(event) => setExpiry(event.target.value)}
          hint="Leave empty for permanent access. A date makes the role lapse on its own, with no transaction needed on the day."
        />

        <p className="flex items-center gap-2">
          <span className="label-xs text-ink-faint">Preview</span>
          <RoleChip
            role={role as Role}
            expiresAt={expiry ? new Date(expiry).toLocaleDateString() : undefined}
          />
        </p>

        <ContractNote
          call={`OrgAccessManager.addMember(${orgId}, ${wallet || "<wallet>"}, ROLE_${role}, ${expiry ? Math.floor(new Date(expiry).getTime() / 1000) : 0})`}
          permission="MANAGE_MEMBERS"
          guards={[
            "Rejects a wallet with no active identity.",
            "Rejects a wallet that is already a member.",
            "Rejects an expiry date in the past.",
          ]}
        />

        <p
          role="status"
          className="rounded-md border border-warn/45 bg-warn/10 p-3 text-xs leading-relaxed text-ink"
        >
          {PENDING_NOTE}
        </p>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

export function ChangeRoleModal({
  member,
  onClose,
  orgId,
}: {
  member: OrgMember | null;
  onClose: () => void;
  orgId: number;
}) {
  const [role, setRole] = React.useState("USER");

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
    member !== null &&
    member.storedRole !== "NONE" &&
    member.role !== member.storedRole;

  return (
    <Modal
      open={member !== null}
      onClose={onClose}
      title={member ? `Change role for ${shortAddress(member.wallet)}` : "Change role"}
      description="Roles are storage entries, never tokens. Nothing here can be sold or transferred to somebody else."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" disabled title={PENDING_NOTE}>
            Sign and change
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
              <Badge tone="warn">
                Lapsed, so it resolves to {member.role} today
              </Badge>
            ) : null}
          </p>

          <Select
            label="New role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            options={ROLE_OPTIONS}
          />

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
            <ContractNote
              call={`OrgAccessManager.assignRole(${orgId}, ${member.wallet}, ROLE_${role}, 0)`}
              permission="ASSIGN_ROLES"
              guards={[
                "Reverts with CannotTargetSelf if you aim it at your own membership — nobody promotes themselves, including a full admin.",
                "Reverts with CannotModifyRootAdmin for the root admin's seat.",
                "Reverts if the target wallet's identity is not active.",
              ]}
            />
          )}

          <p
            role="status"
            className="rounded-md border border-warn/45 bg-warn/10 p-3 text-xs leading-relaxed text-ink"
          >
            {PENDING_NOTE}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
