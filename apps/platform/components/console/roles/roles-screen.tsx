"use client";

import * as React from "react";

import { cn } from "@/lib/cn";
import {
  getPermissionMatrix,
  type MatrixCell,
  type OverrideState,
} from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import {
  Badge,
  Button,
  GlassCard,
  RoleChip,
  type Role,
} from "@/components/ui";
import { ApiErrorPanel, LoadingPanel } from "@/components/console/states";
import {
  ScreenHeader,
  useConsoleScreen,
} from "@/components/console/use-console-screen";

/**
 * Roles and permissions.
 *
 * The matrix is the product, not a settings page. Every cell has three facts
 * behind it — the contract's default, this organisation's override, and what
 * `hasPermission` therefore answers — and the interesting cases are exactly the
 * ones where they disagree. A grid of ticks would hide all of them.
 *
 * Read-only. Changing a cell is a signed transaction from an admin's wallet, and
 * that write path is not switched on yet.
 */

/** Roles that cannot be stripped of governance, and the reason. */
const LOCKED: Array<{ role: string; permission: string }> = [
  { role: "ADMIN", permission: "MANAGE_MEMBERS" },
  { role: "ADMIN", permission: "ASSIGN_ROLES" },
];

function isLocked(role: string, permission: string): boolean {
  return LOCKED.some((l) => l.role === role && l.permission === permission);
}

export function RolesScreen() {
  const { session, orgId, role, gate } = useConsoleScreen();

  const load = React.useCallback(
    () =>
      orgId === null
        ? Promise.reject(new Error("No organisation"))
        : getPermissionMatrix(orgId),
    [orgId],
  );
  const matrix = useResource(gate === null && orgId !== null ? load : null);

  const [selected, setSelected] = React.useState<MatrixCell | null>(null);

  const header = (
    <ScreenHeader kicker="Roles and permissions" title="What each role may do">
      Four roles, six permissions, and one override per cell. A new organisation
      needs none of this configured — the contract ships with a working default —
      and any cell can be changed later without redeploying anything.
    </ScreenHeader>
  );

  if (gate) return <div>{header}{gate}</div>;
  if (!session) return null;

  if (matrix.status === "loading" && !matrix.data) {
    return (
      <div>
        {header}
        <LoadingPanel label="Loading the permission matrix" rows={6} />
      </div>
    );
  }

  if (matrix.status === "error") {
    return (
      <div>
        {header}
        <ApiErrorPanel
          error={matrix.error}
          permission="membership of this organisation"
          role={role}
          onRetry={matrix.reload}
        />
      </div>
    );
  }

  const data = matrix.data;
  if (!data) return <div>{header}</div>;

  const cellFor = (roleName: string, permission: string) =>
    data.cells.find((c) => c.role === roleName && c.permission === permission);

  const overridden = data.cells.filter((c) => c.override !== "Unset");

  return (
    <div>
      {header}

      {!data.organisationActive ? (
        <GlassCard padding="md" role="alert" className="mb-4 border-danger/50">
          <p className="text-sm leading-relaxed text-ink">
            This organisation is suspended, so every permission below currently
            answers false regardless of what the matrix says. The matrix is
            preserved, not cleared — reinstating the organisation restores it
            exactly as shown.
          </p>
        </GlassCard>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <GlassCard padding="none" className="overflow-hidden">
          {/* See the note in asset-table.tsx: `relative` keeps the absolutely
              positioned visually hidden caption inside the scroller. */}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse">
              <caption className="sr-only">
                Permissions by role. Each cell states whether the permission
                applies, and whether that comes from the contract default or from
                an override set by this organisation.
              </caption>
              <thead>
                <tr className="border-b border-border">
                  <th
                    scope="col"
                    className="label-xs px-4 py-3 text-start text-ink-faint"
                  >
                    Permission
                  </th>
                  {data.roles.map((roleName) => (
                    <th key={roleName} scope="col" className="px-2 py-3">
                      <RoleChip role={roleName as Role} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.permissions.map((permission) => (
                  <tr
                    key={permission.key}
                    className="border-b border-border-soft last:border-0"
                  >
                    <th
                      scope="row"
                      className="px-4 py-3 text-start align-middle"
                    >
                      <span className="block text-sm font-medium text-ink">
                        {permission.label}
                      </span>
                      <code className="font-mono text-[0.625rem] text-ink-faint">
                        {permission.key}
                      </code>
                    </th>
                    {data.roles.map((roleName) => {
                      const cell = cellFor(roleName, permission.key);
                      if (!cell) {
                        return (
                          <td key={roleName} className="px-2 py-3 text-center">
                            <span className="text-xs text-ink-faint">—</span>
                          </td>
                        );
                      }
                      return (
                        <td key={roleName} className="px-2 py-3 text-center">
                          <MatrixButton
                            cell={cell}
                            permissionLabel={permission.label}
                            active={
                              selected?.role === cell.role &&
                              selected?.permission === cell.permission
                            }
                            onSelect={() => setSelected(cell)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>

        <div className="flex flex-col gap-4">
          <CellDetail
            cell={selected}
            canEdit={data.canEdit}
            permissions={data.permissions}
          />
          <Legend />
        </div>
      </div>

      <GlassCard padding="md" className="mt-4">
        <h2 className="label-xs mb-3 text-ink-faint">
          Overrides in this organisation
        </h2>
        {overridden.length === 0 ? (
          <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
            None. Every cell is on the contract default, which is what a new
            organisation looks like — zero configuration required before it works.
            Setting an override later never touches the default, so it can always
            be handed back.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {overridden.map((cell) => (
              <li
                key={`${cell.role}-${cell.permission}`}
                className="flex flex-wrap items-center gap-2 border-b border-border-soft pb-2 text-sm last:border-0 last:pb-0"
              >
                <RoleChip role={cell.role as Role} />
                <code className="font-mono text-xs text-ink">
                  {cell.permission}
                </code>
                <Badge tone={cell.override === "Allowed" ? "success" : "danger"}>
                  {cell.override}
                </Badge>
                <span className="text-xs text-ink-faint">
                  default is {cell.default ? "allowed" : "denied"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      <GlassCard padding="md" className="mt-4">
        <h2 className="label-xs mb-3 text-ink-faint">The lockout guard</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
          An organisation cannot deny Admin the ability to manage members or
          assign roles. The contract reverts with{" "}
          <code className="font-mono text-ink">CannotDisableAdminGovernance</code>
          , so those two cells are permanently allowed. Without it, one override
          could lock an organisation out of its own governance with no way back —
          not a hypothetical, just an ordinary mistake with permanent
          consequences.
        </p>
      </GlassCard>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A cell. Shape carries the answer and the source of it, so the matrix is
 * readable without colour: a solid mark means allowed, a hollow one denied, and
 * a ring around either means this organisation overrode the default.
 */
function MatrixButton({
  cell,
  permissionLabel,
  active,
  onSelect,
}: {
  cell: MatrixCell;
  permissionLabel: string;
  active: boolean;
  onSelect: () => void;
}) {
  const overridden = cell.override !== "Unset";
  const label = `${cell.role} ${cell.effective ? "may" : "may not"} ${permissionLabel.toLowerCase()}. ${
    overridden
      ? `Set to ${cell.override} by this organisation; the default is ${cell.default ? "allowed" : "denied"}.`
      : "On the contract default."
  }`;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md border transition-colors duration-200",
        cell.effective
          ? "border-success/45 bg-success/10 text-success"
          : "border-border bg-surface-2 text-ink-faint",
        overridden && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
        active && "border-brand-line bg-brand-soft",
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        {cell.effective ? <path d="M3 8.5l3.5 3.5L13 5" /> : <path d="M4 8h8" />}
      </svg>
    </button>
  );
}

function CellDetail({
  cell,
  canEdit,
  permissions,
}: {
  cell: MatrixCell | null;
  canEdit: boolean;
  permissions: Array<{ key: string; label: string }>;
}) {
  if (!cell) {
    return (
      <GlassCard padding="md">
        <h2 className="label-xs mb-2 text-ink-faint">Cell detail</h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Pick a cell to see where its answer comes from: the contract default,
          an override set here, or both disagreeing.
        </p>
      </GlassCard>
    );
  }

  const label =
    permissions.find((p) => p.key === cell.permission)?.label ?? cell.permission;
  const locked = isLocked(cell.role, cell.permission);

  return (
    <GlassCard padding="md">
      <h2 className="label-xs mb-3 text-ink-faint">Cell detail</h2>

      <p className="mb-4 flex flex-wrap items-center gap-2">
        <RoleChip role={cell.role as Role} />
        <span className="text-sm text-ink-muted">may</span>
        <span className="text-sm font-semibold text-ink">
          {label.toLowerCase()}
        </span>
        <Badge tone={cell.effective ? "success" : "neutral"}>
          {cell.effective ? "Yes, today" : "No, today"}
        </Badge>
      </p>

      <dl className="flex flex-col">
        <DetailRow label="Contract default">
          {cell.default ? "Allowed" : "Denied"}
        </DetailRow>
        <DetailRow label="This organisation">
          <OverrideBadge state={cell.override} />
        </DetailRow>
        <DetailRow label="Result">
          {cell.effective ? "Allowed" : "Denied"}
        </DetailRow>
      </dl>

      {locked ? (
        <p className="mt-4 rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed text-ink-muted">
          This cell cannot be denied. The contract blocks an organisation from
          stripping Admin of its own governance.
        </p>
      ) : null}

      <div className="mt-4 border-t border-border-soft pt-4">
        {canEdit ? (
          <>
            <div
              role="group"
              aria-label="Override state"
              className="flex flex-wrap gap-2"
            >
              {(["Unset", "Allowed", "Denied"] as OverrideState[]).map((state) => (
                <Button
                  key={state}
                  size="sm"
                  variant={cell.override === state ? "primary" : "secondary"}
                  disabled
                  title="Read-only for now: changing a cell is a signed transaction, and that path is not switched on yet."
                >
                  {state}
                </Button>
              ))}
            </div>
            <p
              role="status"
              className="mt-3 text-xs leading-relaxed text-ink-faint"
            >
              You hold Admin, so you would be allowed to change this. Writing it
              is a{" "}
              <code className="font-mono text-ink">
                setPermission({cell.role}, {cell.permission}, …)
              </code>{" "}
              transaction signed in your wallet. That path is read-only until it
              has been reviewed.
            </p>
          </>
        ) : (
          <p className="text-xs leading-relaxed text-ink-faint">
            Only Admin may change a cell, and the contract checks that at the
            moment the transaction runs rather than trusting this page.
          </p>
        )}
      </div>
    </GlassCard>
  );
}

function OverrideBadge({ state }: { state: OverrideState }) {
  if (state === "Unset") return <Badge tone="neutral">No override</Badge>;
  if (state === "Allowed") return <Badge tone="success">Allowed</Badge>;
  return <Badge tone="danger">Denied</Badge>;
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-soft py-2.5 last:border-0">
      <dt className="label-xs shrink-0 text-ink-faint">{label}</dt>
      <dd className="text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

function Legend() {
  return (
    <GlassCard padding="md">
      <h2 className="label-xs mb-3 text-ink-faint">How to read a cell</h2>
      <ul className="flex flex-col gap-3 text-xs text-ink-muted">
        <li className="flex items-center gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-success/45 bg-success/10 text-success">
            <Tick />
          </span>
          Allowed
        </li>
        <li className="flex items-center gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-ink-faint">
            <Dash />
          </span>
          Denied
        </li>
        <li className="flex items-center gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-success/45 bg-success/10 text-success ring-2 ring-accent ring-offset-1 ring-offset-surface">
            <Tick />
          </span>
          A ring means this organisation overrode the default, in either direction
        </li>
      </ul>
    </GlassCard>
  );
}

function Tick() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 8.5l3.5 3.5L13 5" />
    </svg>
  );
}

function Dash() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 8h8" />
    </svg>
  );
}
