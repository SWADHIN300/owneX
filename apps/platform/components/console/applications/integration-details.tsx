"use client";

import * as React from "react";

import type { IntegrationEndpoints } from "@/lib/api";
import { CopyButton } from "@/components/console/copy-field";

/**
 * "Copy integration details" — everything a partner developer has to paste into
 * their own codebase, in one place, with a copy control on each value.
 *
 * The client secret gets its own treatment because it is the one value here that
 * cannot be looked up again. It is shown once, with the warning attached to it
 * rather than buried in documentation, and it is never rendered for an application
 * that already has one — there is nothing to render, because only its digest was
 * stored.
 */

export function SecretOnce({
  clientSecret,
  variant = "issued",
}: {
  clientSecret: string;
  variant?: "issued" | "rotated";
}) {
  const [revealed, setRevealed] = React.useState(false);

  return (
    <div
      role="alert"
      className="rounded-lg border border-warn/50 bg-warn/10 p-3.5"
      data-slot="client-secret-once"
    >
      <p className="label-xs text-warn">
        {variant === "rotated" ? "New client secret" : "Client secret"} — shown once
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink">
        <strong>Save this now.</strong> owneX stores only a hash of it, so this is the only time it
        can be displayed. If it is lost, rotate the secret to issue a new one.
        {variant === "rotated"
          ? " The previous secret has already stopped working."
          : null}
      </p>

      <div className="mt-2.5 flex items-center gap-1.5 rounded-md border border-border-soft bg-surface px-2.5 py-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[0.7rem] text-ink">
          {revealed ? clientSecret : "•".repeat(Math.min(clientSecret.length, 44))}
        </code>
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          className="shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] text-accent underline decoration-dotted underline-offset-2"
        >
          {revealed ? "Hide" : "Reveal"}
        </button>
        <CopyButton value={clientSecret} label="client secret" />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        Put it in the partner application&apos;s <strong>server</strong> environment only. A client
        secret in frontend JavaScript is public, and anyone who reads it can redeem authorization
        codes as that application.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function IntegrationDetails({
  clientId,
  endpoints,
  callbackUrls,
  clientSecret,
  secretVariant,
}: {
  clientId: string;
  endpoints: IntegrationEndpoints;
  callbackUrls: string[];
  /** Present only in the response that issued or rotated it. */
  clientSecret?: string | null;
  secretVariant?: "issued" | "rotated";
}) {
  const envBlock = [
    `${endpoints.envVars.origin}=${new URL(endpoints.exchangeUrl).origin}`,
    `${endpoints.envVars.clientId}=${clientId}`,
    `${endpoints.envVars.clientSecret}=${clientSecret ?? "<the secret you saved>"}`,
    `${endpoints.envVars.orgId}=${new URL(endpoints.verifyUrl).searchParams.get("orgId") ?? ""}`,
    `${endpoints.envVars.redirectUri}=${callbackUrls[0] ?? "<your exact callback URL>"}`,
  ].join("\n");

  return (
    <div className="flex flex-col gap-3">
      {clientSecret ? <SecretOnce clientSecret={clientSecret} variant={secretVariant} /> : null}

      <dl className="flex flex-col">
        <Detail label="Client ID" value={clientId} copyLabel="client id" />
        <Detail
          label="Authorization URL"
          value={endpoints.authorizeUrl}
          copyLabel="authorization URL"
          hint="Send the browser here. Generate a fresh, unguessable state per request and check it on the way back."
        />
        <Detail
          label="Token exchange endpoint"
          value={endpoints.exchangeUrl}
          copyLabel="exchange endpoint"
          hint="POST { client_id, client_secret, code, redirect_uri } from your backend."
        />
        <Detail
          label="Live verification endpoint"
          value={endpoints.verifyUrl}
          copyLabel="verification endpoint"
          hint="Call this on every request you serve, with your client credentials as HTTP Basic auth."
        />
        {callbackUrls.map((callback, index) => (
          <Detail
            key={callback}
            label={callbackUrls.length > 1 ? `Callback URL ${index + 1}` : "Callback URL"}
            value={callback}
            copyLabel="callback URL"
          />
        ))}
      </dl>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="label-xs text-ink-faint">Environment variables</p>
          <CopyButton value={envBlock} label="environment variables" />
        </div>
        <pre className="overflow-x-auto rounded-md border border-border-soft bg-surface/50 p-3 font-mono text-[0.7rem] leading-relaxed text-ink">
          {envBlock}
        </pre>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  copyLabel,
  hint,
}: {
  label: string;
  value: string;
  copyLabel: string;
  hint?: string;
}) {
  return (
    <div className="border-b border-border-soft py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <dt className="label-xs text-ink-faint">{label}</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-xs text-ink" title={value}>
            {value}
          </span>
          <CopyButton value={value} label={copyLabel} />
        </dd>
      </div>
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{hint}</p> : null}
    </div>
  );
}
