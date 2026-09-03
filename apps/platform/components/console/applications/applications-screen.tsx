"use client";

import * as React from "react";

import {
  listApplications,
  rotateClientSecret,
  updateApplication,
  type ConnectedApp,
  type IntegrationStep,
} from "@/lib/api";
import { ROLE_HASH, appIdFromSlug, orgAccessManager, type WritableRole } from "@/lib/contracts";
import { useResource } from "@/lib/use-resource";
import { Badge, Button, GlassCard, RoleChip, type Role } from "@/components/ui";
import { ApiErrorPanel, EmptyPanel, LoadingPanel } from "@/components/console/states";
import { ScreenHeader, useConsoleScreen } from "@/components/console/use-console-screen";
import { MonoValue } from "@/components/console/copy-field";
import { useTransaction } from "@/components/console/tx/use-transaction";
import {
  TransactionDismissed,
  TransactionFailure,
  TransactionRail,
} from "@/components/console/tx/transaction-rail";
import { RegisterAppModal } from "./register-app-modal";
import { IntegrationDetails, SecretOnce } from "./integration-details";

const ROLES: WritableRole[] = ["ADMIN", "MANAGER", "AUDITOR", "USER"];

/**
 * Connected applications — the screen that explains what owneX is for.
 *
 * owneX is a decentralised SSO and authorization layer. A website registered here
 * holds no private key and no blockchain code: it redirects a visitor to owneX,
 * receives a single-use code, and exchanges it from its own backend for a role it
 * can trust — because the answer was read from a contract rather than a table
 * somebody could edit.
 *
 * So this screen shows two kinds of fact and never blurs them:
 *
 *   configuration  callbacks, client id, secret state. Rows in Postgres.
 *   authority      whether the application is registered on-chain and which roles
 *                  `canAccessApp` admits. Read from OrgAccessManager every load.
 *
 * The integration pipeline at the top of each card is the conjunction of both, so
 * an admin can see exactly which of the five steps is missing rather than
 * discovering it as a failed sign-in on somebody else's website.
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
      title="Sign in with owneX"
      actions={
        canManage ? (
          <Button variant="primary" onClick={() => setRegistering(true)}>
            Register an application
          </Button>
        ) : undefined
      }
    >
      owneX is a decentralised SSO and authorization layer. An approved website
      redirects a visitor here for wallet sign-in, and owneX returns a temporary
      authorization code only after checking that visitor&apos;s active identity,
      live role and application permission on-chain. The partner never handles
      private keys or blockchain logic.
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
            Registering one issues it a client id and secret, gives it a key
            on-chain, and lets you choose which roles may sign in. Until then there
            is nothing for{" "}
            <code className="font-mono text-ink">/authorize</code> to authorize.
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
        <h2 className="label-xs mb-3 text-ink-faint">How an approved website uses this</h2>
        <ol className="flex list-decimal flex-col gap-2 ps-5 text-sm leading-relaxed text-ink-muted">
          <li>
            An organisation admin registers the website here. Arbitrary websites cannot
            use owneX — a client id is issued only by this screen.
          </li>
          <li>
            The website redirects the visitor to{" "}
            <code className="font-mono text-ink">
              /authorize?client_id=…&amp;org_id=…&amp;redirect_uri=…&amp;state=…
            </code>
            .
          </li>
          <li>
            The visitor signs a message in their own wallet. No gas, and no
            transaction.
          </li>
          <li>
            owneX reads identity, organisation, membership expiry, role and{" "}
            <code className="font-mono text-ink">canAccessApp</code> live, shows a
            consent screen, and on approval redirects back with a single-use code
            that expires in two minutes.
          </li>
          <li>
            The website&apos;s <strong>backend</strong> exchanges that code with its
            client secret for the verified claims, then issues its own session.
          </li>
          <li>
            On every later request it calls{" "}
            <code className="font-mono text-ink">/api/roles/verify</code>, so a
            revocation or an expiry takes effect immediately.
          </li>
        </ol>
        <p className="mt-4 border-t border-border-soft pt-3 text-xs leading-relaxed text-ink-faint">
          The client secret belongs in the partner&apos;s server environment only.
          In frontend JavaScript it is public, and anyone who reads it can redeem
          authorization codes as that application.
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
  const [showDetails, setShowDetails] = React.useState(false);
  const [rotatedSecret, setRotatedSecret] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"rotate" | "status" | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const revoked = app.status === "revoked";

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

  const rotate = async () => {
    if (
      !window.confirm(
        `Rotate the client secret for ${app.name}?\n\nThe current secret stops working immediately. ${app.name} will not be able to complete a sign-in until the new value is deployed to its server environment.`,
      )
    ) {
      return;
    }
    setBusy("rotate");
    setActionError(null);
    try {
      const result = await rotateClientSecret(app.slug, orgId);
      setRotatedSecret(result.clientSecret);
      setShowDetails(true);
      onChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not rotate the secret");
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status: "active" | "revoked") => {
    if (
      status === "revoked" &&
      !window.confirm(
        `Revoke the ${app.name} integration?\n\nSign-in through it is refused from the next request. Audit history and the application record are kept, and you can restore it later.`,
      )
    ) {
      return;
    }
    setBusy("status");
    setActionError(null);
    try {
      await updateApplication(app.slug, { orgId, status });
      onChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not change the status");
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassCard
      padding="md"
      className={revoked ? "border-danger/45" : app.registered ? undefined : "border-warn/45"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {app.logoUrl ? (
            // A partner logo is an arbitrary remote URL, so next/image is
            // deliberately not used: it would need every partner host listed in the
            // build configuration.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={app.logoUrl}
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 shrink-0 rounded-lg border border-border-soft object-contain"
            />
          ) : null}
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
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {revoked ? <Badge tone="danger">Revoked</Badge> : null}
          {app.callerHasAccess ? (
            <Badge tone="brand">You may use it</Badge>
          ) : (
            <Badge tone="neutral">Your role may not</Badge>
          )}
        </div>
      </div>

      <StagePipeline steps={app.steps} />

      <dl className="mt-4 flex flex-col">
        <Row label="Slug">
          <span className="font-mono text-xs text-ink">{app.slug}</span>
        </Row>
        <Row label="On-chain key">
          <MonoValue value={app.appId} label="application id" head={12} tail={8} />
        </Row>
        {app.clientId ? (
          <Row label="Client ID">
            <MonoValue value={app.clientId} label="client id" head={14} tail={6} />
          </Row>
        ) : null}
        {app.callbackUrls ? (
          <Row label={app.callbackUrls.length === 1 ? "Callback URL" : "Callback URLs"}>
            <span className="flex flex-col items-end gap-1">
              {app.callbackUrls.length === 0 ? (
                <span className="text-xs text-warn">None registered</span>
              ) : (
                app.callbackUrls.map((callback) => (
                  <MonoValue key={callback} value={callback} label="callback URL" head={26} tail={12} />
                ))
              )}
            </span>
          </Row>
        ) : null}
        {app.hasClientSecret !== null ? (
          <Row label="Client secret">
            {app.hasClientSecret ? (
              <span className="text-xs text-ink-muted">
                Stored as a hash
                {app.clientSecretUpdatedAt
                  ? ` · set ${new Date(app.clientSecretUpdatedAt).toLocaleDateString()}`
                  : null}
              </span>
            ) : (
              <span className="text-xs text-warn">Not generated yet</span>
            )}
          </Row>
        ) : null}
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

      {app.rolesPendingOnChain.length > 0 ? (
        <p className="mt-2 rounded-md border border-warn/45 bg-warn/10 p-3 text-xs leading-relaxed text-ink">
          <strong>{app.rolesPendingOnChain.join(", ")}</strong>{" "}
          {app.rolesPendingOnChain.length === 1 ? "was" : "were"} chosen at
          registration but {app.rolesPendingOnChain.length === 1 ? "has" : "have"} no{" "}
          <code className="font-mono">setAppAccess</code> transaction on-chain, so
          the contract still refuses {app.rolesPendingOnChain.length === 1 ? "it" : "them"}.
        </p>
      ) : null}

      <div className="mt-4 border-t border-border-soft pt-4">
        <p className="label-xs mb-3 text-ink-faint">
          Roles that may sign in — read from the contract
        </p>
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
            Each change is one <code className="font-mono">setAppAccess</code>{" "}
            transaction. Access is granted to a role, never to a person, so somebody
            losing that role loses the application in the same block.
          </p>
        ) : null}

        <div className="mt-3 flex flex-col gap-3">
          <TransactionFailure failure={tx.failure} />
          <TransactionRail stage={tx.stage} txHash={tx.txHash} />
          <TransactionDismissed failure={tx.failure} />
        </div>
      </div>

      {canManage ? (
        <div className="mt-4 border-t border-border-soft pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowDetails((value) => !value)}
              disabled={!app.endpoints || !app.clientId}
            >
              {showDetails ? "Hide integration details" : "Copy integration details"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void rotate()}
              loading={busy === "rotate"}
              disabled={busy !== null}
            >
              {app.hasClientSecret ? "Rotate secret" : "Generate secret"}
            </Button>
            {revoked ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void setStatus("active")}
                loading={busy === "status"}
                disabled={busy !== null}
              >
                Restore integration
              </Button>
            ) : (
              <Button
                variant="danger"
                size="sm"
                onClick={() => void setStatus("revoked")}
                loading={busy === "status"}
                disabled={busy !== null}
              >
                Revoke integration
              </Button>
            )}
          </div>

          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            Revoking refuses every new sign-in and code exchange immediately, and
            keeps the application record and its audit history intact.
          </p>

          {actionError ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              {actionError}
            </p>
          ) : null}

          {rotatedSecret && !showDetails ? (
            <div className="mt-3">
              <SecretOnce clientSecret={rotatedSecret} variant="rotated" />
            </div>
          ) : null}

          {showDetails && app.endpoints && app.clientId ? (
            <div className="mt-4">
              <IntegrationDetails
                clientId={app.clientId}
                endpoints={app.endpoints}
                callbackUrls={app.callbackUrls ?? []}
                clientSecret={rotatedSecret}
                secretVariant="rotated"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </GlassCard>
  );
}

/* -------------------------------------------------------------------------- */

function StagePipeline({ steps }: { steps: IntegrationStep[] }) {
  const firstPending = steps.find((step) => !step.done);

  return (
    <div className="mt-4">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {steps.map((step, index) => (
          <li key={step.key} className="flex items-center gap-1.5">
            {index > 0 ? (
              <span aria-hidden className="text-ink-faint">
                →
              </span>
            ) : null}
            <Badge tone={step.done ? "success" : "neutral"}>
              {step.done ? "✓ " : ""}
              {step.label}
            </Badge>
          </li>
        ))}
      </ol>
      {firstPending && firstPending.todo ? (
        <p className="mt-2 text-xs leading-relaxed text-ink-faint">
          <strong className="text-ink">Next:</strong> {firstPending.todo}
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-soft py-2.5 last:border-b-0">
      <dt className="label-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
