"use client";

import * as React from "react";

import { registerApplication, type AppRegistrationResult } from "@/lib/api";
import { ROLE_HASH, getSigner, orgAccessManager, type WritableRole } from "@/lib/contracts";
import { Badge, Button, Input, Modal, RoleChip, type Role } from "@/components/ui";
import { useWallet } from "@/components/wallet/wallet-provider";
import { useTransaction } from "@/components/console/tx/use-transaction";
import {
  TransactionDismissed,
  TransactionFailure,
  TransactionRail,
} from "@/components/console/tx/transaction-rail";
import { IntegrationDetails } from "./integration-details";

/**
 * Registering a third-party application for "Sign in with OwneX".
 *
 * Three things happen, in this order, and the order matters:
 *
 *   1. The platform saves the integration configuration and issues a client id
 *      and secret. The plaintext secret is in that one response and nowhere else.
 *   2. The admin signs `registerApplication(orgId, appId, metadataHash)`. Until
 *      that transaction lands there is no on-chain application, so no access check
 *      can pass — a row in a database is not an integration.
 *   3. The admin signs one `setAppAccess` per role they chose. Access is granted
 *      to a role, never to a person, so somebody losing that role loses the
 *      application in the same block.
 *
 * Steps 2 and 3 are separate transactions because the contract keeps them
 * separate: registering grants nobody anything. That is what stops an admin from
 * accidentally granting access to an application they were only describing.
 */

const ROLES: WritableRole[] = ["ADMIN", "MANAGER", "AUDITOR", "USER"];

export function RegisterAppModal({
  orgId,
  onClose,
  onDone,
}: {
  orgId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { active } = useWallet();

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [logoUrl, setLogoUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [callbacks, setCallbacks] = React.useState<string[]>([""]);
  const [roles, setRoles] = React.useState<WritableRole[]>(["USER"]);

  // `Result` is the prepared payload, passed through `record`, because the client
  // credentials it carries are the whole point of the summary step.
  const tx = useTransaction<AppRegistrationResult, AppRegistrationResult>();
  const [grantingRole, setGrantingRole] = React.useState<WritableRole | null>(null);
  const [grantError, setGrantError] = React.useState<string | null>(null);

  const slugValid = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug);
  const nameValid = name.trim().length >= 2;
  const urlValid = /^https?:\/\/.+/.test(url.trim());
  const logoValid = logoUrl.trim().length === 0 || /^https?:\/\/.+/.test(logoUrl.trim());
  const cleanCallbacks = callbacks.map((value) => value.trim()).filter((value) => value.length > 0);
  const callbacksValid =
    cleanCallbacks.length > 0 && cleanCallbacks.every((value) => describeCallback(value) === null);
  const ready = slugValid && nameValid && urlValid && logoValid && callbacksValid && roles.length > 0;

  const done = tx.stage === "done";

  const close = () => {
    if (tx.busy) return;
    if (done) onDone();
    onClose();
    tx.reset();
  };

  const submit = () =>
    tx.run({
      prepare: () =>
        registerApplication({
          orgId,
          slug,
          name: name.trim(),
          url: url.trim(),
          description: description.trim() || undefined,
          logoUrl: logoUrl.trim() || undefined,
          callbackUrls: cleanCallbacks,
          allowedRoles: roles,
        }),
      send: ({ signer, prepared }) =>
        orgAccessManager(signer).registerApplication(
          prepared.registerArgs.orgId,
          prepared.registerArgs.appId,
          prepared.registerArgs.metadataHash,
        ),
      record: async ({ prepared }) => {
        // Grant the chosen roles now that the application exists on-chain. A
        // rejection here leaves a registered application with no access — a
        // recoverable state the application card can finish later, so it is
        // reported rather than thrown.
        setGrantError(null);
        try {
          if (!active) throw new Error("No wallet is connected.");
          const signer = await getSigner(active.provider);
          for (const role of roles) {
            setGrantingRole(role);
            const response = await orgAccessManager(signer).setAppAccess(
              prepared.registerArgs.orgId,
              prepared.registerArgs.appId,
              ROLE_HASH[role],
              true,
            );
            await response.wait();
          }
        } catch (error) {
          setGrantError(
            error instanceof Error
              ? `${error.message} — grant the remaining roles from the application card.`
              : "One of the access grants was not signed. Grant the remaining roles from the application card.",
          );
        } finally {
          setGrantingRole(null);
        }
        return prepared;
      },
    });

  return (
    <Modal
      open
      onClose={close}
      size="lg"
      title={done ? "Integration details" : "Register an application"}
      description={
        done
          ? "Copy these into the partner application's server environment. The client secret is shown once."
          : "Gives a third-party website a client id, a secret, and a key on-chain. Only applications registered here can use Sign in with owneX."
      }
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={tx.busy}>
            {done ? "Close" : "Cancel"}
          </Button>
          {!done ? (
            <Button variant="primary" onClick={submit} loading={tx.busy} disabled={!ready}>
              {tx.stage === "error" ? "Try again" : "Sign and register"}
            </Button>
          ) : null}
        </>
      }
    >
      {done ? (
        <RegistrationSummary details={tx.result ?? null} roles={roles} grantError={grantError} />
      ) : (
        <div className="flex flex-col gap-4">
          <Input
            label="Application name"
            placeholder="Acme Time Tracking"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              // The slug follows the name until somebody edits it deliberately.
              if (!slug || slug === toSlug(name)) setSlug(toSlug(event.target.value));
            }}
            disabled={tx.busy}
            error={name && !nameValid ? "At least two characters" : undefined}
          />

          <Input
            label="Slug"
            placeholder="acme-time-tracking"
            mono
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
            disabled={tx.busy}
            error={slug && !slugValid ? "Lowercase letters, digits and hyphens" : undefined}
            hint={
              slugValid || !slug
                ? "keccak256 of this is the on-chain key. Changing it later registers a different application."
                : undefined
            }
          />

          <Input
            label="Homepage URL"
            placeholder="https://time.acme.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={tx.busy}
            error={url && !urlValid ? "Needs to be an http or https URL" : undefined}
          />

          <Input
            label="Description"
            placeholder="Where staff log hours against projects"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={tx.busy}
          />

          <Input
            label="Logo URL (optional)"
            placeholder="https://time.acme.com/logo.svg"
            value={logoUrl}
            onChange={(event) => setLogoUrl(event.target.value)}
            disabled={tx.busy}
            error={logoUrl && !logoValid ? "Needs to be an http or https URL" : undefined}
            hint="Shown on the consent screen so the visitor recognises who is asking."
          />

          <fieldset className="flex flex-col gap-2">
            <legend className="label-xs mb-1 text-ink-muted">Callback URLs</legend>
            <p className="text-xs leading-relaxed text-ink-faint">
              Exact URLs, matched character for character. No wildcards and no subdomain patterns.
              https is required unless the host is localhost.
            </p>
            {callbacks.map((value, index) => (
              <div key={index} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    mono
                    aria-label={`Callback URL ${index + 1}`}
                    placeholder="https://time.acme.com/auth/ownex/callback"
                    value={value}
                    onChange={(event) => {
                      const next = [...callbacks];
                      next[index] = event.target.value;
                      setCallbacks(next);
                    }}
                    disabled={tx.busy}
                    error={value.trim() ? (describeCallback(value.trim()) ?? undefined) : undefined}
                  />
                </div>
                {callbacks.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCallbacks(callbacks.filter((_, i) => i !== index))}
                    disabled={tx.busy}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
            {callbacks.length < 10 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCallbacks([...callbacks, ""])}
                disabled={tx.busy}
                className="self-start"
              >
                Add another callback URL
              </Button>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="label-xs mb-1 text-ink-muted">Roles allowed to sign in</legend>
            <p className="text-xs leading-relaxed text-ink-faint">
              Each role you choose is one <code className="font-mono">setAppAccess</code> transaction
              you will be asked to sign after registration.
            </p>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((role) => {
                const chosen = roles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={chosen}
                    disabled={tx.busy}
                    onClick={() =>
                      setRoles(chosen ? roles.filter((r) => r !== role) : [...roles, role])
                    }
                    className="rounded-full disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <span className="flex items-center gap-1.5">
                      <RoleChip role={role as Role} />
                      <Badge tone={chosen ? "success" : "neutral"}>{chosen ? "Yes" : "No"}</Badge>
                    </span>
                  </button>
                );
              })}
            </div>
            {roles.length === 0 ? (
              <p role="alert" className="text-xs text-danger">
                Choose at least one role, or nobody will be able to sign in.
              </p>
            ) : null}
          </fieldset>

          {grantingRole ? (
            <p role="status" className="text-xs text-ink-muted">
              Granting {grantingRole} access — sign in your wallet.
            </p>
          ) : null}

          <TransactionFailure failure={tx.failure} />
          <TransactionRail stage={tx.stage} txHash={tx.txHash} />
          <TransactionDismissed failure={tx.failure} />
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function RegistrationSummary({
  details,
  roles,
  grantError,
}: {
  details: AppRegistrationResult | null;
  roles: WritableRole[];
  grantError: string | null;
}) {
  if (!details) {
    return (
      <p role="status" className="text-sm leading-relaxed text-ink-muted">
        Registered. Open the application card to copy its integration details.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-sm leading-relaxed text-ink-muted">
        <strong className="text-ink">{details.slug}</strong> is registered on-chain, and{" "}
        {roles.join(", ")} may sign in.
      </p>

      {grantError ? (
        <p
          role="alert"
          className="rounded-md border border-warn/45 bg-warn/10 p-3 text-xs leading-relaxed text-ink"
        >
          {grantError}
        </p>
      ) : null}

      <IntegrationDetails
        clientId={details.clientId}
        endpoints={details.endpoints}
        callbackUrls={details.callbackUrls}
        clientSecret={details.clientSecret}
        secretVariant="issued"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The same transport rules the server applies, so the form can refuse a callback
 * before a round trip. The server still decides — this is a courtesy, not a
 * security boundary.
 */
function describeCallback(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Needs to be an absolute URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Must be http or https";
  if (url.search || url.hash) return "No query string or fragment";
  const local =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (!local && url.protocol !== "https:") return "https is required outside localhost";
  return null;
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
