"use client";

import * as React from "react";

import type { MatrixCell, OverrideState } from "@/lib/api";
import {
  OVERRIDE_VALUE,
  PERMISSION_HASH,
  ROLE_HASH,
  orgAccessManager,
  type WritablePermission,
  type WritableRole,
} from "@/lib/contracts";
import {
  Badge,
  Button,
  Modal,
  RoleChip,
  type Role,
} from "@/components/ui";
import { useTransaction } from "@/components/console/tx/use-transaction";
import {
  TransactionDismissed,
  TransactionFailure,
  TransactionRail,
} from "@/components/console/tx/transaction-rail";

/**
 * Changing one cell of the permission matrix.
 *
 * This is the most consequential write in the app — it changes what a whole role
 * may do, for everybody who holds it, immediately — so it asks for the target
 * state explicitly and shows what the answer becomes before anything is signed.
 *
 * Returning a cell to `Unset` is offered as prominently as the other two. An
 * override is not a preference to be tuned; it is a deviation from a default that
 * was chosen carefully, and being able to hand it back is the point of the
 * default existing.
 *
 * The caller keys this on the cell, so switching cells remounts it and the
 * selection starts from whatever that cell actually holds. Deriving that with a
 * ref written during render would work and would also be a lie about when the
 * value is computed.
 */
export function OverrideModal({
  cell,
  orgId,
  onClose,
  onDone,
}: {
  cell: MatrixCell;
  orgId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [target, setTarget] = React.useState<OverrideState>(cell.override);
  const tx = useTransaction();

  const close = () => {
    if (tx.busy) return;
    if (tx.stage === "done") onDone();
    onClose();
    tx.reset();
  };

  const submit = () => {
    tx.run({
      send: ({ signer }) =>
        orgAccessManager(signer).setPermission(
          orgId,
          ROLE_HASH[cell.role as WritableRole],
          PERMISSION_HASH[cell.permission as WritablePermission],
          OVERRIDE_VALUE[target],
        ),
    });
  };

  const wouldBe =
    target === "Allowed" ? true : target === "Denied" ? false : cell.default;

  // The contract refuses to deny Admin its own governance. Saying so before the
  // attempt is better than letting it revert, though it reverts either way.
  const locked =
    cell.role === "ADMIN" &&
    (cell.permission === "MANAGE_MEMBERS" || cell.permission === "ASSIGN_ROLES");
  const blocked = locked && target === "Denied";

  return (
    <Modal
      open
      onClose={close}
      title="Change what this role may do"
      description="Overrides are per organisation. The contract default is never altered, so an override can always be handed back."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={tx.busy}>
            {tx.stage === "done" ? "Close" : "Cancel"}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={tx.busy}
            disabled={blocked || target === cell.override || tx.stage === "done"}
          >
            {tx.stage === "error" ? "Try again" : "Sign and apply"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <RoleChip role={cell.role as Role} />
          <code className="font-mono text-xs text-ink">{cell.permission}</code>
        </p>

        <fieldset
          disabled={tx.busy || tx.stage === "done"}
          className="flex flex-col gap-2"
        >
          <legend className="label-xs mb-1 text-ink-faint">Set this cell to</legend>
          {(["Unset", "Allowed", "Denied"] as OverrideState[]).map((state) => (
            <label
              key={state}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-checked:border-brand-line has-checked:bg-brand-soft"
            >
              <input
                type="radio"
                name="override"
                value={state}
                checked={target === state}
                onChange={() => setTarget(state)}
                className="mt-0.5 size-4 shrink-0 accent-brand"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{state}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                  {state === "Unset"
                    ? `Follow the contract default, which is ${cell.default ? "allowed" : "denied"} for this cell.`
                    : state === "Allowed"
                      ? "Grant it to this role in this organisation, whatever the default says."
                      : "Withhold it from this role in this organisation, whatever the default says."}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <p className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 p-3 text-xs text-ink-muted">
          <span className="label-xs text-ink-faint">Result</span>
          {cell.effective ? (
            <Badge tone="success">Allowed today</Badge>
          ) : (
            <Badge tone="neutral">Denied today</Badge>
          )}
          <span aria-hidden>→</span>
          {wouldBe ? (
            <Badge tone="success">Allowed</Badge>
          ) : (
            <Badge tone="neutral">Denied</Badge>
          )}
          <span className="basis-full">
            Applies to everybody holding this role, from the block this lands in.
          </span>
        </p>

        {blocked ? (
          <p
            role="alert"
            className="rounded-md border border-danger/45 bg-danger/10 p-3 text-xs leading-relaxed text-ink"
          >
            This one cannot be denied. The contract reverts with{" "}
            <code className="font-mono">CannotDisableAdminGovernance</code>, because
            an organisation that could strip Admin of member management would be
            able to lock itself out of its own governance permanently.
          </p>
        ) : null}

        <TransactionFailure failure={tx.failure} />
        <TransactionRail stage={tx.stage} txHash={tx.txHash} />
        <TransactionDismissed failure={tx.failure} />

        {tx.stage === "idle" || tx.stage === "error" ? (
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="label-xs mb-2 text-ink-faint">What this sends</p>
            <code className="block font-mono text-[0.6875rem] break-all text-ink">
              OrgAccessManager.setPermission({orgId}, ROLE_{cell.role},{" "}
              {cell.permission}, {target})
            </code>
            <p className="mt-2 text-xs text-ink-muted">
              Needs an effective role of{" "}
              <code className="font-mono text-ink">ADMIN</code> — not merely the
              ASSIGN_ROLES permission. Reshaping the matrix is deliberately
              narrower than using it.
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
