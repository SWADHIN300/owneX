"use client";

import * as React from "react";

import { listMembers, type OrgMember } from "@/lib/api";
import { shortAddress } from "@/lib/wallet";
import { useResource } from "@/lib/use-resource";
import {
  Badge,
  Button,
  GlassCard,
  Identicon,
  RoleChip,
  VerificationBadge,
  type Role,
} from "@/components/ui";
import {
  ApiErrorPanel,
  EmptyPanel,
  LoadingPanel,
} from "@/components/console/states";
import {
  ScreenHeader,
  useConsoleScreen,
} from "@/components/console/use-console-screen";
import { MonoValue, explorerAddressUrl } from "@/components/console/copy-field";
import {
  AddMemberModal,
  ChangeRoleModal,
  RemoveMemberModal,
} from "./member-actions";

/**
 * Members.
 *
 * The roster comes from the contract's own enumeration, so it cannot drift out of
 * step with who actually holds a role. Two things are shown that a naive roster
 * would lose:
 *
 *   the root admin, who is a member with no membership record — the seat comes
 *   from creating the organisation, not from being added to it
 *
 *   a lapsed time-bound role, which still has a role in storage while resolving
 *   to no access today. Hiding the row would make the expiry look like a bug
 */
export function MembersScreen() {
  const { session, orgId, role, gate } = useConsoleScreen();

  const load = React.useCallback(
    () => (orgId === null ? Promise.reject(new Error("No organisation")) : listMembers(orgId)),
    [orgId],
  );
  const members = useResource(gate === null && orgId !== null ? load : null);

  const [addOpen, setAddOpen] = React.useState(false);
  const [changing, setChanging] = React.useState<OrgMember | null>(null);
  const [removing, setRemoving] = React.useState<OrgMember | null>(null);

  const canManage = role === "ADMIN";

  /**
   * The contract reverts with `CannotTargetSelf` for your own membership, so the
   * control is disabled rather than left to fail. Nobody removes or promotes
   * themselves here — including a full admin.
   */
  const isSelf = (member: OrgMember) =>
    session?.wallet.toLowerCase() === member.wallet.toLowerCase();

  const header = (
    <ScreenHeader
      kicker="Members"
      title={members.data?.organisation?.name ?? "Organisation members"}
      actions={
        canManage ? (
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            Add member
          </Button>
        ) : undefined
      }
    >
      Who belongs to this organisation, and what each wallet may do. Roles are
      re-read from the chain on every load, so a revocation shows up here
      immediately rather than when somebody&apos;s session expires.
    </ScreenHeader>
  );

  if (gate) return <div>{header}{gate}</div>;
  if (!session) return null;

  if (members.status === "loading" && !members.data) {
    return (
      <div>
        {header}
        <LoadingPanel label="Loading the member roster" rows={5} />
      </div>
    );
  }

  if (members.status === "error") {
    return (
      <div>
        {header}
        <ApiErrorPanel
          error={members.error}
          permission="membership of this organisation"
          role={role}
          onRetry={members.reload}
        />
      </div>
    );
  }

  const list = members.data;
  if (!list) return <div>{header}</div>;

  if (list.members.length === 0) {
    return (
      <div>
        {header}
        <EmptyPanel title="No members yet">
          <p>
            An admin adds a member by wallet address. The wallet needs an active
            identity first — the contract refuses to add one that has none, which
            is what stops a roster filling up with addresses nobody controls.
          </p>
        </EmptyPanel>
      </div>
    );
  }

  const lapsed = list.members.filter((m) => m.expired).length;
  const expiring = list.members.filter(
    (m) => !m.expired && m.expiresAt !== null,
  ).length;

  return (
    <div>
      {header}

      {list.organisation && !list.organisation.active ? (
        <GlassCard padding="md" role="alert" className="mb-4 border-danger/50">
          <p className="text-sm leading-relaxed text-ink">
            This organisation is suspended. Every permission inside it answers
            false while that lasts, whatever the roles below say, so nobody can
            mint, reassign or read audit history until it is reinstated.
          </p>
        </GlassCard>
      ) : null}

      <dl className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Members" value={String(list.count)} />
        <Stat label="Time-bound" value={String(expiring)} />
        <Stat label="Lapsed" value={String(lapsed)} />
        <Stat
          label="Certificates held"
          value={String(list.members.reduce((sum, m) => sum + m.assetCount, 0))}
        />
      </dl>

      <GlassCard padding="none" className="overflow-hidden">
        {/* `relative` is load-bearing. A visually hidden label inside a table
            cell is `position: absolute`, so without a positioned ancestor its
            containing block is the page and the scroll container cannot clip it —
            one 1px span at the far end of a 796px table pushed the document to
            722px at a 390px viewport. Making the scroller the containing block
            keeps every such label inside it. */}
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse">
            <caption className="sr-only">
              Members of this organisation with role, access expiry and identity
              status.
            </caption>
            <thead>
              <tr className="border-b border-border">
                <Th>Member</Th>
                <Th>Role</Th>
                <Th>Access</Th>
                <Th>Identity</Th>
                <Th>Assets</Th>
                {canManage ? (
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {list.members.map((member) => (
                <tr
                  key={member.wallet}
                  className="border-b border-border-soft last:border-0 hover:bg-brand-soft/50"
                >
                  <Td>
                    <div className="flex min-w-0 items-center gap-3">
                      <Identicon value={member.wallet} size={32} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {member.profile?.displayName ?? shortAddress(member.wallet)}
                          {member.isRootAdmin ? (
                            <Badge tone="brand" className="ms-2">
                              Root admin
                            </Badge>
                          ) : null}
                        </p>
                        <span className="flex items-center gap-1">
                          <MonoValue
                            value={member.wallet}
                            label="member address"
                            href={explorerAddressUrl(member.wallet)}
                            head={8}
                            tail={6}
                          />
                        </span>
                        {member.profile?.jobTitle ? (
                          <p className="truncate text-xs text-ink-faint">
                            {member.profile.jobTitle}
                            {member.profile.department
                              ? ` · ${member.profile.department}`
                              : ""}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </Td>

                  <Td>
                    <RoleChip role={member.role as Role} />
                    {/* The stored role is only worth showing when it disagrees
                        with the effective one, which means the membership has
                        lapsed. The root admin has no stored record at all — the
                        seat comes from creating the organisation — so "was NONE"
                        there would describe a mechanism, not a change. */}
                    {member.storedRole !== "NONE" && member.role !== member.storedRole ? (
                      <p className="mt-1 text-[0.625rem] text-ink-faint">
                        was {member.storedRole}
                      </p>
                    ) : null}
                  </Td>

                  <Td>
                    {member.expiresAt === null ? (
                      <span className="text-xs text-ink-muted">Permanent</span>
                    ) : member.expired ? (
                      <Badge tone="danger">
                        Lapsed {new Date(member.expiresAt * 1000).toLocaleDateString()}
                      </Badge>
                    ) : (
                      <Badge tone="warn">
                        Until {new Date(member.expiresAt * 1000).toLocaleDateString()}
                      </Badge>
                    )}
                  </Td>

                  <Td>
                    {!member.identity.registered ? (
                      <VerificationBadge state="unverified" />
                    ) : member.identity.active ? (
                      <VerificationBadge state="verified" />
                    ) : (
                      <VerificationBadge state="revoked" />
                    )}
                  </Td>

                  <Td>
                    <span className="font-mono text-xs text-ink">
                      {member.assetCount}
                    </span>
                  </Td>

                  {canManage ? (
                    <Td>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setChanging(member)}
                          disabled={member.isRootAdmin}
                          title={
                            member.isRootAdmin
                              ? "The root admin's seat cannot be changed here"
                              : undefined
                          }
                        >
                          Change role
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRemoving(member)}
                          disabled={member.isRootAdmin || isSelf(member)}
                          title={
                            member.isRootAdmin
                              ? "The root admin cannot be removed"
                              : isSelf(member)
                                ? "You cannot remove your own membership"
                                : undefined
                          }
                          className="text-danger hover:bg-danger/10"
                        >
                          Remove
                        </Button>
                      </div>
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {!list.canSeeProfiles ? (
        <p className="mt-3 text-xs text-ink-faint">
          Names, job titles and departments are only returned to Admin and
          Manager, so this roster shows wallets and roles. The addresses are
          public on-chain either way.
        </p>
      ) : null}

      {lapsed > 0 ? (
        <GlassCard padding="md" className="mt-4">
          <p className="text-sm leading-relaxed text-ink-muted">
            {lapsed === 1 ? "One membership has" : `${lapsed} memberships have`}{" "}
            lapsed. Nothing had to run for that to happen: the contract compares
            the expiry against the block timestamp, so access ended on the day it
            was set to end whether or not anybody was watching.
          </p>
        </GlassCard>
      ) : null}

      {orgId !== null ? (
        <>
          <AddMemberModal
            open={addOpen}
            onClose={() => setAddOpen(false)}
            orgId={orgId}
            onDone={members.reload}
          />
          <ChangeRoleModal
            member={changing}
            onClose={() => setChanging(null)}
            orgId={orgId}
            onDone={members.reload}
          />
          <RemoveMemberModal
            member={removing}
            onClose={() => setRemoving(null)}
            orgId={orgId}
            onDone={members.reload}
          />
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <GlassCard padding="md">
      <dt className="label-xs mb-2 text-ink-faint">{label}</dt>
      <dd className="font-mono text-3xl font-bold tracking-tight text-brand">
        {value}
      </dd>
    </GlassCard>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="label-xs px-4 py-3 text-start whitespace-nowrap text-ink-faint"
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-top">{children}</td>;
}
