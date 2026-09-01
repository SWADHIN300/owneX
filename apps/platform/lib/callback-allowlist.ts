/**
 * Callback (redirect_uri) allow-list for the owneX identity provider.
 *
 * Kept free of any I/O or Supabase imports so it can be unit tested directly
 * (see lib/callback-allowlist.test.ts) and so a misconfigured database can never
 * be the reason a legitimate partner callback is refused.
 *
 * Every rejection carries a machine-readable reason. The old code returned a bare
 * `false`, which meant a rejected sign-in was indistinguishable from a typo in an
 * environment variable — the exact situation that made the "callback URI is not
 * registered" page impossible to debug in production.
 */

export const APP_SLUG = "employee-portal";

/** Hostname of the canonical production deployment of the Employee Portal. */
export const PRODUCTION_PORTAL_HOST = "ownex-employee-portal.vercel.app";

/** Paths the portal is allowed to be sent back to. */
const ALLOWED_PATHS = new Set(["", "/callback", "/api/callback", "/dashboard"]);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export type CallbackRejection =
  | "UNKNOWN_APP"
  | "MISSING_URI"
  | "MALFORMED_URI"
  | "UNSUPPORTED_SCHEME"
  | "INSECURE_SCHEME"
  | "HOST_NOT_ALLOWED"
  | "PATH_NOT_ALLOWED";

export type CallbackCheck =
  | { ok: true; normalized: string; matchedBy: "configured" | "local" | "production" | "preview" }
  | { ok: false; reason: CallbackRejection };

type EnvLike = Record<string, string | undefined>;

/**
 * Callbacks pinned by configuration. `PORTAL_CALLBACK_URL` is the single value the
 * portal itself uses; `PORTAL_CALLBACK_URLS` is an optional comma-separated list so a
 * custom domain can be added without a code change.
 */
export function configuredCallbacks(env: EnvLike): string[] {
  const raw = [env.PORTAL_CALLBACK_URL ?? "", ...(env.PORTAL_CALLBACK_URLS ?? "").split(",")];
  return raw.map((value) => value.trim()).filter((value) => value.length > 0);
}

function isLocal(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
}

/**
 * Canonical form used for comparison: lowercase scheme and host, default port
 * dropped, trailing slash removed, query and fragment discarded. Without this,
 * `https://Host/callback/` and `https://host:443/callback` would be treated as
 * different callbacks from the one that is configured.
 */
function canonicalize(uri: string): { url: URL; normalized: string } | null {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const defaultPort = url.protocol === "https:" ? "443" : "80";
  if (url.port === defaultPort) url.port = "";

  url.search = "";
  url.hash = "";

  const pathname = url.pathname.replace(/\/+$/, "");
  const normalized = `${url.protocol}//${url.host.toLowerCase()}${pathname}`;
  return { url, normalized };
}

/** True when the host is a Vercel deployment of this portal (branch or commit preview). */
function isPortalPreviewHost(hostname: string): boolean {
  return hostname.endsWith(".vercel.app") && hostname.includes("employee-portal");
}

/**
 * Decide whether `uri` may receive an authorization code for `app`, and say why not
 * when the answer is no.
 */
export function checkCallback(app: string, uri: unknown, env: EnvLike = process.env): CallbackCheck {
  if (app !== APP_SLUG) return { ok: false, reason: "UNKNOWN_APP" };
  if (typeof uri !== "string" || uri.trim().length === 0) {
    return { ok: false, reason: "MISSING_URI" };
  }

  const candidate = canonicalize(uri);
  if (!candidate) {
    // Distinguish "not a URL at all" from "a URL we refuse to speak", so an
    // operator reading the reason knows whether to fix a typo or a scheme.
    return { ok: false, reason: /^[a-z][a-z0-9+.-]*:/i.test(uri.trim()) ? "UNSUPPORTED_SCHEME" : "MALFORMED_URI" };
  }

  // 1. Exactly what configuration pins, compared after normalisation.
  for (const configured of configuredCallbacks(env)) {
    const pinned = canonicalize(configured);
    if (pinned && pinned.normalized === candidate.normalized) {
      return { ok: true, normalized: candidate.normalized, matchedBy: "configured" };
    }
  }

  const hostname = candidate.url.hostname.toLowerCase();
  const pathname = candidate.url.pathname.replace(/\/+$/, "");

  // 2. Local development, over either scheme.
  if (isLocal(hostname)) {
    if (!ALLOWED_PATHS.has(pathname)) return { ok: false, reason: "PATH_NOT_ALLOWED" };
    return { ok: true, normalized: candidate.normalized, matchedBy: "local" };
  }

  // 3. Everything remotely reachable must be TLS, otherwise the code travels in clear text.
  if (candidate.url.protocol !== "https:") return { ok: false, reason: "INSECURE_SCHEME" };

  const matchedBy =
    hostname === PRODUCTION_PORTAL_HOST
      ? "production"
      : isPortalPreviewHost(hostname)
        ? "preview"
        : null;

  if (!matchedBy) return { ok: false, reason: "HOST_NOT_ALLOWED" };
  if (!ALLOWED_PATHS.has(pathname)) return { ok: false, reason: "PATH_NOT_ALLOWED" };

  return { ok: true, normalized: candidate.normalized, matchedBy };
}

/** Human-readable explanation for an operator or a developer looking at the reject page. */
export function explainRejection(reason: CallbackRejection): string {
  switch (reason) {
    case "UNKNOWN_APP":
      return "The requested application slug is not registered with owneX.";
    case "MISSING_URI":
      return "The request did not include a redirect_uri.";
    case "MALFORMED_URI":
      return "The redirect_uri is not an absolute URL.";
    case "UNSUPPORTED_SCHEME":
      return "The redirect_uri must use http or https.";
    case "INSECURE_SCHEME":
      return "Non-local callbacks must use https.";
    case "HOST_NOT_ALLOWED":
      return "The callback host is not on the owneX allow-list. Set PORTAL_CALLBACK_URL (or add it to PORTAL_CALLBACK_URLS) on the platform deployment.";
    case "PATH_NOT_ALLOWED":
      return "The callback path is not one of /callback, /api/callback, /dashboard or /.";
  }
}
