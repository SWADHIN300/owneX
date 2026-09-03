/**
 * Callback (redirect_uri) validation for the owneX identity provider.
 *
 * This module is *pure*: no Supabase import, no `process.env` read that is not
 * passed in. The caller looks the application up (see `lib/applications.ts`) and
 * hands the registered callback list in. That keeps the security decision unit
 * testable and keeps a database outage from silently widening or narrowing it.
 *
 * WHAT CHANGED, AND WHY
 *   The previous version hard-coded the Employee Portal: one slug, one production
 *   hostname, a set of "allowed paths", and a wildcard for `*.vercel.app` hosts
 *   containing "employee-portal". Any of those rules would let an application the
 *   organization never registered receive an authorization code, and the wildcard
 *   in particular trusted a hostname substring — a preview host an attacker can
 *   create. All of it is gone. A callback is now accepted only when it matches,
 *   exactly, a URL an organization admin registered for that specific
 *   application.
 *
 * THE RULES
 *   1. The application must exist and be active.
 *   2. The URI must parse as an absolute http(s) URL.
 *   3. It must equal a registered callback after safe canonicalisation
 *      (lowercase scheme and host, default port dropped, one trailing slash
 *      dropped). No substring matching, no wildcards, no path allow-list.
 *   4. Remote callbacks must be https.
 *   5. http is permitted for loopback hosts in development only. In production a
 *      loopback callback is refused outright, so a stale local value in a
 *      production deployment cannot become an accepted callback.
 *
 * Every rejection carries a machine-readable reason, because a redirect the user
 * never sees is impossible to debug from a blank failure.
 */

export type CallbackMode = "development" | "production";

export type CallbackRejection =
  | "UNKNOWN_APP"
  | "APPLICATION_REVOKED"
  | "MISSING_URI"
  | "MALFORMED_URI"
  | "UNSUPPORTED_SCHEME"
  | "INSECURE_SCHEME"
  | "LOCALHOST_NOT_ALLOWED"
  | "NO_CALLBACK_REGISTERED"
  | "CALLBACK_NOT_REGISTERED"
  | "CALLBACK_HAS_PARAMETERS"
  | "CALLBACK_TOO_LONG";

export type CallbackCheck =
  | {
      ok: true;
      /** Canonical form of the request's redirect_uri. */
      normalized: string;
      /**
       * The registered URL that matched, verbatim. Redirects are always built
       * from THIS value rather than from anything the browser supplied, which is
       * what makes an open redirect impossible.
       */
      registered: string;
    }
  | { ok: false; reason: CallbackRejection };

/** The minimum an application must expose for a callback decision to be made. */
export type CallbackSubject = {
  status?: string | null;
  callbacks: readonly string[];
};

export const MAX_CALLBACK_LENGTH = 2048;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** Which security profile applies. Production is the stricter one. */
export function callbackMode(env: Record<string, string | undefined> = process.env): CallbackMode {
  return env.NODE_ENV === "production" ? "production" : "development";
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  // 127.0.0.0/8 is entirely loopback.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Canonical form used for comparison: lowercase scheme and host, default port
 * dropped, a single trailing slash dropped, query and fragment discarded.
 *
 * Without this, `https://Host/callback/` and `https://host:443/callback` would be
 * treated as different callbacks from the one that was registered — a false
 * rejection that looks exactly like an attack.
 *
 * Query and fragment are dropped rather than compared because registration
 * refuses to store them (see `validateRegistrableCallback`), and because the
 * redirect the platform performs is always built from the registered URL. A
 * parameter smuggled into `redirect_uri` therefore cannot reach the partner.
 */
export function canonicalizeCallback(uri: string): { url: URL; normalized: string } | null {
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

  // Collapse a trailing slash so "/callback" and "/callback/" are one callback,
  // but keep the root path as "" consistently.
  const pathname = url.pathname.replace(/\/+$/, "");
  const normalized = `${url.protocol}//${url.host.toLowerCase()}${pathname}`;
  return { url, normalized };
}

function schemeRejection(uri: string): CallbackRejection {
  // Distinguish "not a URL at all" from "a URL in a scheme we refuse to speak",
  // so an operator reading the reason knows whether to fix a typo or a scheme.
  return /^[a-z][a-z0-9+.-]*:/i.test(uri.trim()) ? "UNSUPPORTED_SCHEME" : "MALFORMED_URI";
}

/**
 * Transport rules, shared between "may this be registered" and "may this receive
 * a code". Keeping them in one function is what guarantees an admin cannot
 * register a callback that would later be refused, or vice versa.
 */
function checkTransport(url: URL, mode: CallbackMode): CallbackRejection | null {
  if (isLoopbackHost(url.hostname)) {
    // A loopback callback is a development affordance. In production it is either
    // a misconfiguration or an attempt to bounce a code through the user's own
    // machine, and neither should be honoured.
    return mode === "production" ? "LOCALHOST_NOT_ALLOWED" : null;
  }
  // Anything remotely reachable must be TLS, or the authorization code travels
  // in clear text.
  return url.protocol === "https:" ? null : "INSECURE_SCHEME";
}

/**
 * Decide whether `uri` may receive an authorization code for this application,
 * and say why not when the answer is no.
 */
export function checkCallback(params: {
  application: CallbackSubject | null | undefined;
  uri: unknown;
  mode?: CallbackMode;
}): CallbackCheck {
  const mode = params.mode ?? callbackMode();
  const app = params.application;

  if (!app) return { ok: false, reason: "UNKNOWN_APP" };
  if (app.status === "revoked") return { ok: false, reason: "APPLICATION_REVOKED" };

  const { uri } = params;
  if (typeof uri !== "string" || uri.trim().length === 0) {
    return { ok: false, reason: "MISSING_URI" };
  }
  if (uri.length > MAX_CALLBACK_LENGTH) return { ok: false, reason: "CALLBACK_TOO_LONG" };

  const candidate = canonicalizeCallback(uri);
  if (!candidate) return { ok: false, reason: schemeRejection(uri) };

  const transport = checkTransport(candidate.url, mode);
  if (transport) return { ok: false, reason: transport };

  const registered = (app.callbacks ?? []).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (registered.length === 0) return { ok: false, reason: "NO_CALLBACK_REGISTERED" };

  for (const entry of registered) {
    const pinned = canonicalizeCallback(entry);
    if (pinned && pinned.normalized === candidate.normalized) {
      return { ok: true, normalized: candidate.normalized, registered: entry };
    }
  }

  return { ok: false, reason: "CALLBACK_NOT_REGISTERED" };
}

/**
 * Whether a URL an admin typed may be stored as a callback.
 *
 * Applied at registration time so a callback cannot be saved that the
 * authorization endpoint would then refuse — the failure would surface as a
 * broken sign-in long after the form was submitted.
 */
export function validateRegistrableCallback(
  uri: unknown,
  mode: CallbackMode = callbackMode(),
): { ok: true; normalized: string } | { ok: false; reason: CallbackRejection } {
  if (typeof uri !== "string" || uri.trim().length === 0) {
    return { ok: false, reason: "MISSING_URI" };
  }
  if (uri.length > MAX_CALLBACK_LENGTH) return { ok: false, reason: "CALLBACK_TOO_LONG" };

  const trimmed = uri.trim();

  let raw: URL;
  try {
    raw = new URL(trimmed);
  } catch {
    return { ok: false, reason: schemeRejection(trimmed) };
  }
  if (raw.protocol !== "http:" && raw.protocol !== "https:") {
    return { ok: false, reason: "UNSUPPORTED_SCHEME" };
  }
  // A registered callback is compared without its query string, so storing one
  // would create the illusion that it is part of the identity of the callback.
  if (raw.search.length > 0 || raw.hash.length > 0) {
    return { ok: false, reason: "CALLBACK_HAS_PARAMETERS" };
  }

  const transport = checkTransport(raw, mode);
  if (transport) return { ok: false, reason: transport };

  const canonical = canonicalizeCallback(trimmed);
  if (!canonical) return { ok: false, reason: "MALFORMED_URI" };

  return { ok: true, normalized: canonical.normalized };
}

/**
 * Validate a whole callback list before anything is written, and report every
 * failure at once. Saving three of four callbacks and reporting one error would
 * leave the integration in a state the admin did not ask for.
 */
export function validateCallbackList(
  urls: readonly string[],
  mode: CallbackMode = callbackMode(),
): string[] {
  const problems: string[] = [];
  for (const raw of urls) {
    const result = validateRegistrableCallback(raw, mode);
    if (!result.ok) problems.push(`${raw}: ${explainRejection(result.reason)}`);
  }
  return problems;
}

/**
 * Build the URL the browser is sent back to.
 *
 * Takes the REGISTERED callback, never the requested one, and appends only the
 * parameters this protocol defines. This is the single place a redirect target is
 * constructed, which is what makes "prevent open redirects" a property of the
 * code rather than a habit.
 */
export function buildCallbackRedirect(
  registeredCallback: string,
  params: { code?: string; error?: string; state: string },
): URL {
  const target = new URL(registeredCallback);
  // Discard anything that came with the registered value; only these three
  // parameters ever leave the platform.
  target.search = "";
  target.hash = "";
  if (params.code) target.searchParams.set("code", params.code);
  if (params.error) target.searchParams.set("error", params.error);
  target.searchParams.set("state", params.state);
  return target;
}

/** Human-readable explanation for an operator or a developer reading a reject page. */
export function explainRejection(reason: CallbackRejection): string {
  switch (reason) {
    case "UNKNOWN_APP":
      return "No application is registered with owneX for that client_id and organization.";
    case "APPLICATION_REVOKED":
      return "This integration has been revoked by an organization administrator.";
    case "MISSING_URI":
      return "The request did not include a redirect_uri.";
    case "MALFORMED_URI":
      return "The redirect_uri is not an absolute URL.";
    case "UNSUPPORTED_SCHEME":
      return "The redirect_uri must use http or https.";
    case "INSECURE_SCHEME":
      return "Callbacks that are not on localhost must use https.";
    case "LOCALHOST_NOT_ALLOWED":
      return "A localhost callback is only accepted in local development.";
    case "NO_CALLBACK_REGISTERED":
      return "This application has no callback URL registered yet. An administrator must add one on the Applications screen.";
    case "CALLBACK_NOT_REGISTERED":
      return "That redirect_uri is not one of the callback URLs registered for this application.";
    case "CALLBACK_HAS_PARAMETERS":
      return "A registered callback URL must not contain a query string or fragment.";
    case "CALLBACK_TOO_LONG":
      return `A callback URL must be at most ${MAX_CALLBACK_LENGTH} characters.`;
  }
}
