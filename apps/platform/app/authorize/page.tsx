import Link from "next/link";
import { sessionWallet } from "@/lib/session";
import { validRedirect } from "@/lib/authorize";
import { readEffectiveRole, appIdFromSlug, readCanAccessApp } from "@/lib/chain";
import { Badge, Button, GlassCard, Identicon, RoleChip, shortenAddress, type Role } from "@/components/ui";

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ app?: string; redirect_uri?: string; state?: string }>;
}) {
  const q = await searchParams;
  const appSlug = q.app ?? "";
  const redirectUri = q.redirect_uri ?? "";
  const state = q.state ?? "";

  // 1. Validate callback & application slug
  if (!appSlug || !redirectUri || !state || !validRedirect(appSlug, redirectUri)) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <GlassCard padding="lg" className="w-full max-w-md border-danger/40 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/15 text-danger">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-ink">Authorization Rejected</h1>
          <p className="mt-2 text-sm text-ink-muted leading-relaxed">
            The requested callback URI or application is not registered or allowed by owneX.
          </p>
          <div className="mt-6">
            <Link href="/" className="inline-block w-full">
              <Button variant="secondary" className="w-full">
                Return to Dashboard
              </Button>
            </Link>
          </div>
        </GlassCard>
      </main>
    );
  }

  // 2. Check current session wallet
  const wallet = await sessionWallet();

  if (!wallet) {
    // Build a returnTo URL so the homepage can redirect back here after wallet sign-in
    const returnTo = `/authorize?app=${encodeURIComponent(appSlug)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    const signInHref = `/?returnTo=${encodeURIComponent(returnTo)}`;

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
          <p className="label-xs text-accent">Single Sign-On</p>
          <h1 className="mt-1 text-xl font-bold text-ink">Sign in required</h1>
          <p className="mt-2 text-sm text-ink-muted leading-relaxed">
            Sign in on owneX with your Web3 wallet to authorize <strong>Employee Portal</strong>.
          </p>
          <div className="mt-6">
            <Link href={signInHref} className="inline-block w-full">
              <Button variant="primary" className="w-full">
                Sign in with Wallet
              </Button>
            </Link>
          </div>
        </GlassCard>
      </main>
    );
  }

  // 3. Read live on-chain role & permission for display
  const appId = appIdFromSlug(appSlug);
  let role: string = "USER";
  let hasAccess = true;

  try {
    const [r, a] = await Promise.all([
      readEffectiveRole(1, wallet),
      readCanAccessApp(1, wallet, appId),
    ]);
    role = r;
    hasAccess = a;
  } catch (err) {
    console.warn("Could not read on-chain role for authorize display:", err);
    role = "USER";
    hasAccess = true;
  }

  const cancelUrl = new URL(redirectUri);
  cancelUrl.searchParams.set("state", state);
  cancelUrl.searchParams.set("error", "ACCESS_DENIED");

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <GlassCard padding="lg" className="w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-soft pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/20 text-brand font-mono font-bold text-sm">
              oX
            </div>
            <div>
              <p className="label-xs text-ink-faint">Single Sign-On</p>
              <h2 className="text-xs font-semibold text-ink">owneX Identity Provider</h2>
            </div>
          </div>
          <Badge tone="brand">Sepolia</Badge>
        </div>

        {/* Title & App Info */}
        <div className="mt-6">
          <h1 className="text-xl font-bold tracking-tight text-ink">
            Share your work identity with Employee Portal?
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            The portal requests verifiable proof of your on-chain membership and assigned assets.
          </p>
        </div>

        {/* Identity & Role Preview */}
        <div className="mt-5 rounded-xl border border-border-soft bg-surface/40 p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <Identicon value={wallet} size={28} />
              <div className="min-w-0">
                <p className="font-mono text-xs font-medium text-ink truncate">
                  {shortenAddress(wallet)}
                </p>
                <p className="text-[11px] text-ink-faint">Connected work wallet</p>
              </div>
            </div>
            {role !== "NONE" ? <RoleChip role={role as Role} /> : <Badge tone="warn">No Role</Badge>}
          </div>

          {!hasAccess && (
            <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-xs text-ink">
              <strong>Notice:</strong> Your current role (<code>{role}</code>) has not been granted
              access to this application on-chain. Approving may result in access denial.
            </div>
          )}
        </div>

        {/* Scopes Requested */}
        <div className="mt-5 space-y-2.5">
          <p className="label-xs text-ink-faint">Requested Permissions</p>
          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2 text-ink-muted">
              <span className="mt-0.5 text-accent font-bold">✓</span>
              <div>
                <strong className="text-ink">Verified Organization Role:</strong> Live role proof
                validated directly from smart contract.
              </div>
            </div>
            <div className="flex items-start gap-2 text-ink-muted">
              <span className="mt-0.5 text-accent font-bold">✓</span>
              <div>
                <strong className="text-ink">Assigned Assets:</strong> View hardware certificates and
                software licenses assigned to your address.
              </div>
            </div>
            <div className="flex items-start gap-2 text-ink-muted">
              <span className="mt-0.5 text-accent font-bold">✓</span>
              <div>
                <strong className="text-ink">Public Profile:</strong> Display name and department
                associated with this identity.
              </div>
            </div>
          </div>
        </div>

        {/* Security Note */}
        <div className="mt-5 rounded-lg border border-border-soft bg-surface/20 p-3 text-[11px] leading-relaxed text-ink-faint">
          🔒 <strong>Privacy & Security:</strong> No private keys, signatures, or wallet secrets are
          ever shared with the application. A temporary 2-minute single-use authorization code will be
          issued.
        </div>

        {/* Actions Form */}
        <form action="/api/authorize/approve" method="POST" className="mt-6 flex items-center gap-3">
          <input type="hidden" name="app" value={appSlug} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="state" value={state} />

          <a href={cancelUrl.toString()} className="flex-1">
            <Button type="button" variant="secondary" className="w-full">
              Cancel
            </Button>
          </a>

          <Button type="submit" variant="primary" className="flex-1">
            Approve and continue
          </Button>
        </form>
      </GlassCard>
    </main>
  );
}
