"use client";

import * as React from "react";

import { listApplications, type ConnectedApp } from "@/lib/api";
import {
  ROLE_HASH,
  appIdFromSlug,
  orgAccessManager,
  type WritableRole,
} from "@/lib/contracts";
import { useResource } from "@/lib/use-resource";
import {
  Badge,
  Button,
  GlassCard,
  RoleChip,
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
import { MonoValue } from "@/components/console/copy-field";
import { useTransaction } from "@/components/console/tx/use-transaction";
import {
  TransactionDismissed,
  TransactionFailure,
  TransactionRail,
} from "@/components/console/tx/transaction-rail";
import { RegisterAppModal } from "./register-app-modal";

const ROLES: WritableRole[] = ["ADMIN", "MANAGER", "AUDITOR", "USER"];

/**
 * Connected applications.
 *
 * This is the screen that explains what owneX is for. An application registered
 * here holds no blockchain code at all: it redirects a visitor to sign, calls
 * `/api/roles/verify`, and gets back a role it can trust — because the answer was
 * read from the contract rather than from a table somebody could edit.
 *
 * Which roles may reach an application is therefore shown as chain state, and the
 * toggles write to the chain. Nothing here is a database flag pretending to be an
 * access control.
 */
export function ApplicationsScreen() {
  const { session, orgId, role, gate } = useConsoleScreen();

  const load = React.useCallback(
    () => (orgId === null ? Promise.reject(new Error("No organisation")) : listApplications(orgId)),
    [orgId],
  );
  const apps = useResource(gate === null && orgId !== null ? load : null);

  const [registering, setRegistering] = React.useState(false);

  const canManage = session?.permissions?.MANAGE_APPS ?? false;

  const header = (
    <ScreenHeader
      kicker="Applications"
      title="Single sign-on"
      actions={
        canManage ? (
          <Button variant="primary" onClick={() => setRegistering(true)}>
            Register an application
          </Button>
        ) : undefined
      }
    >
      An application connected here needs no wallet library and no contract code.
      It asks who a visitor is and what they may do, and the answer comes from the
      chain.
    </ScreenHeader>
  );

  if (gate) return <div>{header}{gate}</div>;
  if (!session) return null;

  if (apps.status === "loading" && !apps.data) {
    return (
      <div>
        {header}
        <LoadingPanel label="Loading connected applications" rows={3} />
      </div>
    );
  }

  if (apps.status === "error") {
    return (
      <div>
        {header}
        <ApiErrorPanel
          error={apps.error}
          permission="membership of this organisation"
          role={role}
          onRetry={apps.reload}
        />
      </div>
    );
  }

  const list = apps.data;
  if (!list) return <div>{header}</div>;

  return (
    <div>
      {header}

      {list.applications.length === 0 ? (
        <EmptyPanel title="No applications connected yet">
          <p>
            Registering one gives it a key on-chain and a set of roles that may
            reach it. Until then there is nothing for{" "}
            <code className="font-mono text-ink">/api/roles/verify</code> to
            answer about.
          </p>
        </EmptyPanel>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.applications.map((app) => (
            <li key={app.slug}>
              <AppCard
                app={app}
                orgId={orgId as number}
                canManage={canManage}
                onChanged={apps.reload}
              />
            </li>
          ))}
        </ul>
      )}

      <GlassCard padding="md" className="mt-4">
        <h2 className="label-xs mb-3 text-ink-faint">How an application uses this</h2>
        <ol className="flex list-decimal flex-col gap-2 ps-5 text-sm leading-relaxed text-ink-muted">
          <li>The visitor lands on the application and is sent here to sign in.</li>
          <li>They sign a message. No gas, and no transaction.</li>
          <li>
            The application calls{" "}
            <code className="font-mono text-ink">
              /api/roles/verify?wallet=…&amp;orgId=…&amp;appId=…
            </code>
            .
          </li>
          <li>
            It receives the effective role and whether that role may use it, then
            issues its own session.
          </li>
        </ol>
        <p className="mt-4 border-t border-border-soft pt-3 text-xs leading-relaxed text-ink-faint">
          That endpoint is deliberately unauthenticated in this build, because it
          answers only what is already public on-chain. A production version would
          issue a revocable API key per application so a compromised integration
          could be cut off without touching anything else.
        </p>
      </GlassCard>

      {registering && orgId !== null ? (
        <RegisterAppModal
          orgId={orgId}
          onClose={() => setRegistering(false)}
          onDone={apps.reload}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AppCard({
  app,
  orgId,
  canManage,
  onChanged,
}: {
  app: ConnectedApp;
  orgId: number;
  canManage: boolean;
  onChanged: () => void;
}) {
  const tx = useTransaction();
  const [pending, setPending] = React.useState<WritableRole | null>(null);

  const toggle = (target: WritableRole, allowed: boolean) => {
    setPending(target);
    tx.run({
      send: ({ signer }) =>
        orgAccessManager(signer).setAppAccess(
          orgId,
          appIdFromSlug(app.slug),
          ROLE_HASH[target],
          allowed,
        ),
      record: async () => {
        onChanged();
      },
    });
  };

  return (
    <GlassCard padding="md" className={app.registered ? undefined : "border-warn/45"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{app.name}</h3>
          <a
            href={app.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs break-all text-accent underline decoration-dotted underline-offset-2"
          >
            {app.url}
          </a>
          {app.description ? (
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
              {app.description}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {app.registered ? (
            <Badge tone="success">Registered on-chain</Badge>
          ) : (
            <Badge tone="warn">Not registered yet</Badge>
          )}
          {app.callerHasAccess ? (
            <Badge tone="brand">You may use it</Badge>
          ) : (
            <Badge tone="neutral">Your role may not</Badge>
          )}
        </div>
      </div>

      <dl className="mt-4 flex flex-col">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-soft py-2.5">
          <dt className="label-xs text-ink-faint">Slug</dt>
          <dd className="font-mono text-xs text-ink">{app.slug}</dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
          <dt className="label-xs text-ink-faint">On-chain key</dt>
          <dd className="min-w-0">
            <MonoValue value={app.appId} label="application id" head={12} tail={8} />
          </dd>
        </div>
      </dl>

      {!app.appIdMatchesSlug ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-danger/45 bg-danger/10 p-3 text-xs leading-relaxed text-ink"
        >
          The stored key does not match what this slug hashes to. Access checks use
          the hash of the slug, so whichever key was stored is not the one being
          consulted.
        </p>
      ) : null}

      <div className="mt-4 border-t border-border-soft pt-4">
        <p className="label-xs mb-3 text-ink-faint">Roles that may sign in</p>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((roleName) => {
            const allowed = app.access[roleName] ?? false;
            return (
              <button
                key={roleName}
                type="button"
                disabled={!canManage || tx.busy || !app.registered}
                aria-pressed={allowed}
                onClick={() => toggle(roleName, !allowed)}
                title={
                  !app.registered
                    ? "Register the application on-chain before granting access"
                    : canManage
                      ? allowed
                        ? `Withdraw access from ${roleName}`
                        : `Grant access to ${roleName}`
                      : "Needs MANAGE_APPS"
                }
                className="rounded-full disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="flex items-center gap-1.5">
                  <RoleChip role={roleName as Role} />
                  {allowed ? (
                    <Badge tone="success">
                      {pending === roleName && tx.busy ? "Signing" : "Allowed"}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">
                      {pending === roleName && tx.busy ? "Signing" : "No"}
                    </Badge>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {canManage ? (
          <p className="mt-3 text-xs text-ink-faint">
            Each change is one{" "}
            <code className="font-mono">setAppAccess</code> transaction. Access is
            granted to a role, never to a person, so somebody losing that role
            loses the application in the same block.
          </p>
        ) : null}

        <div className="mt-3 flex flex-col gap-3">
          <TransactionFailure failure={tx.failure} />
          <TransactionRail stage={tx.stage} txHash={tx.txHash} />
          <TransactionDismissed failure={tx.failure} />
        </div>
      </div>
    </GlassCard>
  );
}
