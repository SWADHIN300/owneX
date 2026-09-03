import Link from "next/link";
import { z } from "zod";

import { sessionWallet } from "@/lib/session";
import {
  RegistryUnavailableError,
  explainResolveRejection,
  resolveAuthorizationRequest,
  type RegisteredApplication,
} from "@/lib/applications";
import { buildCallbackRedirect } from "@/lib/callback-allowlist";
import { evaluateLiveAccess } from "@/lib/live-access";
import { explainDenial } from "@/lib/access-decision";
import { publicEnv } from "@/lib/env";
import { shortenAddress } from "@/lib/address";
import { Badge, Button, GlassCard, Identicon, RoleChip, type Role } from "@/components/ui";

/**
 * GET /authorize?client_id=…&org_id=…&redirect_uri=…&state=…
 *
 * The consent screen for "Sign in with OwneX". Generic: every word a visitor
 * reads about the requesting application comes from the row an organization admin
 * registered, so a second or a fiftieth integration needs no change here.
 *
 * ORDER OF CHECKS, AND WHY IT IS THIS ORDER
 *   1. Shape of the request. A missing `state` is refused outright rather than
 *      defaulted, because `state` is the partner's CSRF defence and silently
 *      proceeding without it would break the guarantee on the partner's side.
 *   2. The application, resolved from `client_id` + `org_id` in the database, and
 *      the `redirect_uri` matched exactly against its registered callbacks. Until
 *      this passes, nothing is echoed back to any URL the browser supplied — an
 *      unvalidated redirect_uri is an open redirect, so errors before this point
 *      are rendered here instead of redirected.
 *   3. The session. No wallet, no consent screen.
 *   4. Live chain state. Identity registered and active, organization active,
 *      membership unexpired, a role, and that role allowed for this application.
 *      An RPC failure renders "cannot verify" — never an approve button.
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({
  client_id: z.string().min(8).max(128),
  org_id: z.coerce.number().int().positive(),
  redirect_uri: z.string().min(8).max(2048),
  // Long enough to be unguessable. A partner that omits it, or sends something
  // trivial, has no CSRF protection on its callback and is told so.
  state: z.string().min(8).max(512),
});

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const parsed = querySchema.safeParse({
    client_id: first(raw.client_id),
    org_id: first(raw.org_id),
    redirect_uri: first(raw.redirect_uri),
    state: first(raw.state),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return (
      <RejectionCard
        code={`INVALID_${String(issue?.path[0] ?? "REQUEST").toUpperCase()}`}
        detail={describeShapeProblem(String(issue?.path[0] ?? ""))}
      />
    );
  }

  const { client_id: clientId, org_id: orgId, redirect_uri: redirectUri, state } = parsed.data;

  let resolved;
  try {
    resolved = await resolveAuthorizationRequest({ clientId, orgId, redirectUri });
  } catch (error) {
    if (error instanceof RegistryUnavailableError) {
      return (
        <RejectionCard
          code="REGISTRY_UNAVAILABLE"
          detail="owneX could not reach its application registry, so this request cannot be authorized right now. Nothing was approved."
          tone="warn"
        />
      );
    }
    throw error;
  }

  if (!resolved.ok) {
    return <RejectionCard code={resolved.reason} detail={explainResolveRejection(resolved.reason)} />;
  }

  const { application, registeredCallback } = resolved;

  // From here the callback is proven to be one this application registered, so it
  // is safe to send the user back to it. It is used verbatim — never the string
  // from the query — which is what forecloses an open redirect.
  const denyUrl = buildCallbackRedirect(registeredCallback, { error: "access_denied", state });

  const wallet = await sessionWallet();

  if (!wallet) {
    const returnTo = `/authorize?client_id=${encodeURIComponent(clientId)}&org_id=${orgId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    return (
      <SignInCard application={application} signInHref={`/?returnTo=${encodeURIComponent(returnTo)}`} />
    );
  }

  const access = await evaluateLiveAccess({ orgId, wallet, appSlug: application.slug });

  if (!access.ok) {
    // Fail closed. No consent form, and no code, when the authority cannot be read.
    return (
      <RejectionCard
        code="CHAIN_UNAVAILABLE"
        detail="owneX could not read your identity and role from the blockchain, so it cannot confirm your access. No authorization was issued. Try again shortly."
        tone="warn"
        backTo={{ href: denyUrl.toString(), label: `Return to ${application.name}` }}
      />
    );
  }

  const { decision, snapshot } = access;

  if (!decision.allowed && decision.reason) {
    return (
      <DenialCard
        application={application}
        wallet={wallet}
        role={snapshot.role}
        reason={decision.reason}
        detail={explainDenial(decision.reason)}
        denyHref={denyUrl.toString()}
      />
    );
  }

  const grantedPermissions = Object.entries(snapshot.permissions ?? {})
    .filter(([, allowed]) => allowed)
    .map(([key]) => key);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <GlassCard padding="lg" className="w-full max-w-lg shadow-2xl">
        <header className="flex items-center justify-between border-b border-border-soft pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/20 text-brand font-mono text-sm font-bold">
              oX
            </div>
            <div>
              <p className="label-xs text-ink-faint">Sign in with owneX</p>
              <h2 className="text-xs font-semibold text-ink">Decentralised SSO and authorization</h2>
            </div>
          </div>
          <Badge tone="brand">{publicEnv.NEXT_PUBLIC_CHAIN_NAME}</Badge>
        </header>

        <div className="mt-6 flex items-start gap-3">
          <AppMark application={application} />
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-ink">
              Allow {application.name} to verify your owneX identity and organization role?
            </h1>
            <a
              href={application.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 block truncate text-xs text-accent underline decoration-dotted underline-offset-2"
            >
              {application.url}
            </a>
            {application.description ? (
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">{application.description}</p>
            ) : null}
          </div>
        </div>

        {/* What the application will receive. Wallet, organization, role, and the
            permission booleans that follow from the role. Nothing else exists to
            show, because nothing else is sent. */}
        <div className="mt-5 rounded-xl border border-border-soft bg-surface/40 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Identicon value={wallet} size={28} />
              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-medium text-ink">
                  {shortenAddress(wallet)}
                </p>
                <p className="text-[11px] text-ink-faint">Organization #{orgId}</p>
              </div>
            </div>
            <RoleChip role={snapshot.role as Role} />
          </div>
        </div>

        <div className="mt-5 space-y-2.5">
          <p className="label-xs text-ink-faint">This application will receive</p>
          <ul className="space-y-2 text-xs">
            <Claim label="Wallet address">{shortenAddress(wallet)}</Claim>
            <Claim label="Organization">#{orgId}</Claim>
            <Claim label="Role, read live from the contract">{snapshot.role}</Claim>
            <Claim label="Permission flags">
              {grantedPermissions.length > 0
                ? grantedPermissions.map((key) => key.replaceAll("_", " ").toLowerCase()).join(", ")
                : "none"}
            </Claim>
          </ul>
        </div>

        <div className="mt-5 rounded-lg border border-border-soft bg-surface/20 p-3 text-[11px] leading-relaxed text-ink-faint">
          🔒 <strong className="text-ink">What is never shared:</strong> your private key, seed
          phrase or signature, and no email address, phone number, profile detail or document.{" "}
          {application.name} receives a single-use code that expires in two minutes and can be
          redeemed once, from its own server.
        </div>

        <form action="/api/authorize/approve" method="POST" className="mt-6 flex items-center gap-3">
          {/* Every value is re-validated server-side on submit; these inputs are a
              convenience, not a source of trust. */}
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="org_id" value={String(orgId)} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="state" value={state} />

          <a href={denyUrl.toString()} className="flex-1">
            <Button type="button" variant="secondary" className="w-full">
              Cancel
            </Button>
          </a>
          <Button type="submit" variant="primary" className="flex-1">
            Allow
          </Button>
        </form>
      </GlassCard>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function describeShapeProblem(field: string): string {
  switch (field) {
    case "client_id":
      return "The request did not include a client_id. A partner application must send the client id owneX issued to it.";
    case "org_id":
      return "The request did not include a valid org_id.";
    case "redirect_uri":
      return "The request did not include a redirect_uri.";
    case "state":
      return "The request did not include a state value of at least 8 characters. state is what protects the partner's callback from cross-site request forgery, so owneX refuses requests without one.";
    default:
      return "The authorization request was malformed.";
  }
}

function AppMark({ application }: { application: RegisteredApplication }) {
  if (application.logoUrl) {
    return (
      // Registered logos are arbitrary remote URLs, so next/image is deliberately
      // not used here: it would need every partner host allow-listed in the build
      // configuration, which defeats the point of a self-service registry.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={application.logoUrl}
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 rounded-lg border border-border-soft object-contain"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-soft bg-surface/60 text-sm font-semibold text-ink-muted">
      {application.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function Claim({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-ink-muted">
      <span className="mt-0.5 font-bold text-accent">✓</span>
      <div>
        <strong className="text-ink">{label}:</strong> <span className="font-mono">{children}</span>
      </div>
    </li>
  );
}

function RejectionCard({
  code,
  detail,
  tone = "danger",
  backTo,
}: {
  code: string;
  detail: string;
  tone?: "danger" | "warn";
  backTo?: { href: string; label: string };
}) {
  const border = tone === "danger" ? "border-danger/40" : "border-warn/45";
  const bubble = tone === "danger" ? "bg-danger/15 text-danger" : "bg-warn/15 text-warn";

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <GlassCard padding="lg" className={`w-full max-w-md text-center ${border}`}>
        <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${bubble}`}>
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-ink">Authorization not completed</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          owneX will only authorize an application an organization administrator has registered, at a
          callback URL that was registered with it.
        </p>
        <p className="mt-3 rounded-lg border border-border-soft bg-surface/30 p-2.5 text-left text-[11px] leading-relaxed text-ink-faint">
          <span className="font-mono font-semibold text-ink">{code}</span>
          <br />
          {detail}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {backTo ? (
            <a href={backTo.href} className="inline-block w-full">
              <Button variant="secondary" className="w-full">
                {backTo.label}
              </Button>
            </a>
          ) : null}
          <Link href="/" className="inline-block w-full">
            <Button variant="ghost" className="w-full">
              Go to owneX
            </Button>
          </Link>
        </div>
      </GlassCard>
    </main>
  );
}

function SignInCard({
  application,
  signInHref,
}: {
  application: RegisteredApplication;
  signInHref: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <GlassCard padding="lg" className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand/15 text-brand">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </div>
        <p className="label-xs text-accent">Sign in with owneX</p>
        <h1 className="mt-1 text-xl font-bold text-ink">Sign in required</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Sign in to owneX with your wallet to continue to <strong>{application.name}</strong>.
          Signing is free and creates no blockchain transaction.
        </p>
        <div className="mt-6">
          <Link href={signInHref} className="inline-block w-full">
            <Button variant="primary" className="w-full">
              Sign in with wallet
            </Button>
          </Link>
        </div>
      </GlassCard>
    </main>
  );
}

function DenialCard({
  application,
  wallet,
  role,
  reason,
  detail,
  denyHref,
}: {
  application: RegisteredApplication;
  wallet: string;
  role: string;
  reason: string;
  detail: string;
  denyHref: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <GlassCard padding="lg" className="w-full max-w-md border-warn/45 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warn/15 text-warn">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-ink">You cannot sign in to {application.name}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Your wallet {shortenAddress(wallet)} holds the role <strong>{role}</strong> in this
          organization, and the chain does not permit this sign-in.
        </p>
        <p className="mt-3 rounded-lg border border-border-soft bg-surface/30 p-2.5 text-left text-[11px] leading-relaxed text-ink-faint">
          <span className="font-mono font-semibold text-ink">{reason}</span>
          <br />
          {detail}
        </p>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          No authorization code was issued. Ask an administrator to grant your role access to this
          application.
        </p>
        <div className="mt-6">
          <a href={denyHref} className="inline-block w-full">
            <Button variant="secondary" className="w-full">
              Return to {application.name}
            </Button>
          </a>
        </div>
      </GlassCard>
    </main>
  );
}
