/**
 * Employee Portal configuration.
 *
 * The portal is the worked example of a "Sign in with OwneX" partner: an ordinary
 * Next.js app with no wallet library, no contract ABI and no private key. All it
 * has is the four values below, and all four come from its own environment rather
 * than from anything hard-coded in the platform.
 *
 * That is the point of this file. Before, the platform's authorization logic
 * contained the string "employee-portal" and a fallback secret; now the platform
 * knows only what an organization admin registered, and the portal knows only what
 * it was configured with.
 *
 * OWNEX_CLIENT_SECRET is read on the server only. It appears in no client
 * component, no `NEXT_PUBLIC_` variable and no response body.
 */

export type OwnexConfig = {
  origin: string;
  clientId: string;
  clientSecret: string;
  orgId: number;
  /** The exact callback URL registered with owneX for this integration. */
  redirectUri: string;
  /** Slug used when asking owneX to revalidate access. */
  appSlug: string;
};

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Origin of the owneX platform, without a trailing slash. */
export function getPlatformOrigin(): string {
  const configured = process.env.OWNEX_ORIGIN ?? process.env.PLATFORM_ORIGIN;
  if (configured) return configured.replace(/\/+$/, "");
  if (isProduction()) return "https://ownex-platform.vercel.app";
  return "http://localhost:3000";
}

/** The callback this portal is reachable at. Must match what owneX has registered. */
export function getRedirectUri(): string {
  const configured = process.env.OWNEX_REDIRECT_URI ?? process.env.PORTAL_CALLBACK_URL;
  if (configured) return configured.trim();
  if (isProduction()) return "https://ownex-employee-portal.vercel.app/callback";
  return "http://localhost:3001/callback";
}

export function getOrgId(): number {
  const raw = process.env.OWNEX_ORG_ID ?? process.env.PORTAL_ORG_ID ?? "1";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError("OWNEX_ORG_ID must be a positive integer");
  }
  return parsed;
}

export function getAppSlug(): string {
  return process.env.OWNEX_APP_SLUG ?? "employee-portal";
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * The full configuration, or a thrown `ConfigError`.
 *
 * There is deliberately no default client id and no default client secret. The
 * previous version fell back to `"employee-portal-local-secret"`, which meant a
 * deployment that forgot to set the variable still worked — with a secret written
 * in the repository. Failing loudly is the only safe behaviour: a partner without
 * credentials has no integration.
 */
export function ownexConfig(): OwnexConfig {
  const clientId = process.env.OWNEX_CLIENT_ID?.trim();
  const clientSecret = process.env.OWNEX_CLIENT_SECRET?.trim();

  if (!clientId) {
    throw new ConfigError(
      "OWNEX_CLIENT_ID is not set. Register this application on the owneX Applications screen and copy its client id.",
    );
  }
  if (!clientSecret) {
    throw new ConfigError(
      "OWNEX_CLIENT_SECRET is not set. It is shown once when the application is registered, and can be reissued with 'Rotate secret'.",
    );
  }

  return {
    origin: getPlatformOrigin(),
    clientId,
    clientSecret,
    orgId: getOrgId(),
    redirectUri: getRedirectUri(),
    appSlug: getAppSlug(),
  };
}

/**
 * HTTP Basic header for the live verification endpoint.
 *
 * Server-side only. If this string ever reaches a browser, the integration is
 * compromised and the secret must be rotated.
 */
export function clientAuthHeader(config: OwnexConfig): string {
  const encoded = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  return `Basic ${encoded}`;
}
