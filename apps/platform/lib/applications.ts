import { db } from "./supabase";
import { appIdFromSlug, type RoleName } from "./chain";
import {
  checkCallback,
  callbackMode,
  explainRejection as explainCallbackRejection,
  type CallbackMode,
  type CallbackRejection,
} from "./callback-allowlist";

/**
 * The application registry — the answer to "may this website use owneX at all?"
 *
 * A website is usable only because an organization admin registered it. There is
 * no discovery, no self-service, and no implicit trust in anything the browser
 * sends: `client_id`, `org_id` and `redirect_uri` are all resolved against this
 * table before a consent screen is even rendered.
 *
 * WHAT THIS TABLE IS AND IS NOT
 *   It holds integration configuration and display detail: name, homepage, logo,
 *   callbacks, client id, the *hash* of the client secret, status. It does NOT
 *   decide who may sign in. Whether a role may reach an application is read from
 *   `OrgAccessManager` every time, because an access answer that could be edited
 *   in Postgres would not be worth asking for.
 *
 * FAIL CLOSED
 *   Every function here throws `RegistryUnavailableError` when Supabase errors,
 *   and returns null only when the row genuinely does not exist. Callers turn the
 *   former into 503 and the latter into a rejection. Neither can become an
 *   approval.
 */

export const APPLICATION_STATUSES = ["draft", "active", "revoked"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const ASSIGNABLE_ROLES: RoleName[] = ["ADMIN", "MANAGER", "AUDITOR", "USER"];

/** Raised when the registry cannot be consulted. Never swallowed into a boolean. */
export class RegistryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryUnavailableError";
  }
}

export type RegisteredApplication = {
  orgId: number;
  slug: string;
  /** keccak256(slug) — recomputed, never trusted from the row. */
  appId: string;
  /** What the row claims, so a hand-edited mismatch can be surfaced. */
  storedAppId: string | null;
  name: string;
  url: string;
  description: string | null;
  logoUrl: string | null;
  clientId: string | null;
  clientSecretHash: string | null;
  clientSecretUpdatedAt: string | null;
  allowedRoles: RoleName[];
  status: ApplicationStatus;
  callbacks: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

const COLUMNS =
  "org_id, app_slug, app_id, name, url, description, logo_url, client_id, client_secret_hash, client_secret_updated_at, allowed_roles, status, created_at, updated_at";

type Row = Record<string, unknown>;

function toStatus(value: unknown): ApplicationStatus {
  return APPLICATION_STATUSES.includes(value as ApplicationStatus)
    ? (value as ApplicationStatus)
    : "draft";
}

function toRoles(value: unknown): RoleName[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<RoleName>();
  for (const entry of value) {
    const name = String(entry).toUpperCase() as RoleName;
    if (ASSIGNABLE_ROLES.includes(name)) seen.add(name);
  }
  return ASSIGNABLE_ROLES.filter((role) => seen.has(role));
}

function toRecord(row: Row, callbacks: string[]): RegisteredApplication {
  const slug = String(row.app_slug);
  return {
    orgId: Number(row.org_id),
    slug,
    // Derived, not read. Access checks hash the slug, so the derived value is the
    // only one that describes reality.
    appId: appIdFromSlug(slug),
    storedAppId: row.app_id === null || row.app_id === undefined ? null : String(row.app_id),
    name: String(row.name ?? slug),
    url: String(row.url ?? ""),
    description: row.description === null || row.description === undefined ? null : String(row.description),
    logoUrl: row.logo_url === null || row.logo_url === undefined ? null : String(row.logo_url),
    clientId: row.client_id === null || row.client_id === undefined ? null : String(row.client_id),
    clientSecretHash:
      row.client_secret_hash === null || row.client_secret_hash === undefined
        ? null
        : String(row.client_secret_hash),
    clientSecretUpdatedAt:
      row.client_secret_updated_at === null || row.client_secret_updated_at === undefined
        ? null
        : String(row.client_secret_updated_at),
    allowedRoles: toRoles(row.allowed_roles),
    status: toStatus(row.status),
    callbacks,
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function readCallbacks(orgId: number, slug: string): Promise<string[]> {
  const { data, error } = await db()
    .from("application_callbacks")
    .select("callback_url")
    .eq("org_id", orgId)
    .eq("app_slug", slug)
    .order("callback_url", { ascending: true });

  if (error) throw new RegistryUnavailableError(`Could not read callback URLs: ${error.message}`);
  return (data ?? []).map((row) => String(row.callback_url));
}

/** Callbacks for several applications in one round trip. */
async function readCallbacksForOrg(orgId: number): Promise<Map<string, string[]>> {
  const { data, error } = await db()
    .from("application_callbacks")
    .select("app_slug, callback_url")
    .eq("org_id", orgId)
    .order("callback_url", { ascending: true });

  if (error) throw new RegistryUnavailableError(`Could not read callback URLs: ${error.message}`);

  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const slug = String(row.app_slug);
    const list = map.get(slug) ?? [];
    list.push(String(row.callback_url));
    map.set(slug, list);
  }
  return map;
}

/**
 * Resolve by client id. This is the lookup the authorization endpoint uses, so it
 * is deliberately the narrowest one: a single row, keyed by a value only the
 * partner's own configuration contains.
 */
export async function findApplicationByClientId(
  clientId: string,
): Promise<RegisteredApplication | null> {
  if (typeof clientId !== "string" || clientId.trim().length === 0) return null;

  const { data, error } = await db()
    .from("applications")
    .select(COLUMNS)
    .eq("client_id", clientId.trim())
    .maybeSingle();

  if (error) throw new RegistryUnavailableError(`Could not read the application: ${error.message}`);
  if (!data) return null;

  const callbacks = await readCallbacks(Number(data.org_id), String(data.app_slug));
  return toRecord(data as Row, callbacks);
}

export async function findApplicationBySlug(
  orgId: number,
  slug: string,
): Promise<RegisteredApplication | null> {
  const { data, error } = await db()
    .from("applications")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("app_slug", slug)
    .maybeSingle();

  if (error) throw new RegistryUnavailableError(`Could not read the application: ${error.message}`);
  if (!data) return null;

  const callbacks = await readCallbacks(orgId, slug);
  return toRecord(data as Row, callbacks);
}

export async function listApplicationsForOrg(orgId: number): Promise<RegisteredApplication[]> {
  const { data, error } = await db()
    .from("applications")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error) throw new RegistryUnavailableError(`Could not list applications: ${error.message}`);

  const callbacks = await readCallbacksForOrg(orgId);
  return (data ?? []).map((row) => toRecord(row as Row, callbacks.get(String(row.app_slug)) ?? []));
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Replace the callback set for an application.
 *
 * Delete-then-insert rather than a merge, because the admin's form submits the
 * complete intended set: a callback the admin removed must actually stop being
 * accepted, and a merge would silently keep it.
 */
export async function replaceCallbacks(
  orgId: number,
  slug: string,
  callbacks: string[],
): Promise<void> {
  const unique = Array.from(new Set(callbacks.map((value) => value.trim()))).filter(
    (value) => value.length > 0,
  );

  const deletion = await db()
    .from("application_callbacks")
    .delete()
    .eq("org_id", orgId)
    .eq("app_slug", slug);

  if (deletion.error) {
    throw new RegistryUnavailableError(`Could not replace callback URLs: ${deletion.error.message}`);
  }

  if (unique.length === 0) return;

  const insertion = await db()
    .from("application_callbacks")
    .insert(unique.map((callback_url) => ({ org_id: orgId, app_slug: slug, callback_url })));

  if (insertion.error) {
    throw new RegistryUnavailableError(`Could not save callback URLs: ${insertion.error.message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Authorization request resolution                                            */
/* -------------------------------------------------------------------------- */
export type ResolvedRequest =
  | {
      ok: true;
      application: RegisteredApplication;
      /** The registered callback that matched, verbatim. */
      registeredCallback: string;
    }
  | { ok: false; reason: ResolveRejection };

export type ResolveRejection =
  | "UNKNOWN_CLIENT"
  | "ORG_MISMATCH"
  | "SECRET_NOT_GENERATED"
  | CallbackRejection;

/**
 * The one function that decides whether an authorization request is even
 * addressable: client id known, organization matching, application not revoked,
 * redirect_uri exactly registered.
 *
 * Nothing about the *user* is considered here — that is the chain's answer, made
 * separately. Keeping the two apart is what stops a database row from ever
 * implying a person has access.
 */
export async function resolveAuthorizationRequest(params: {
  clientId: string;
  orgId: number;
  redirectUri: unknown;
  mode?: CallbackMode;
  /** Require a generated client secret. True for exchange, false for /authorize. */
  requireSecret?: boolean;
}): Promise<ResolvedRequest> {
  const application = await findApplicationByClientId(params.clientId);
  if (!application) return { ok: false, reason: "UNKNOWN_CLIENT" };
  if (application.orgId !== params.orgId) return { ok: false, reason: "ORG_MISMATCH" };
  if (application.status === "revoked") return { ok: false, reason: "APPLICATION_REVOKED" };
  if (params.requireSecret && !application.clientSecretHash) {
    return { ok: false, reason: "SECRET_NOT_GENERATED" };
  }

  const callback = checkCallback({
    application,
    uri: params.redirectUri,
    mode: params.mode ?? callbackMode(),
  });

  if (!callback.ok) return { ok: false, reason: callback.reason };

  return { ok: true, application, registeredCallback: callback.registered };
}

export function explainResolveRejection(reason: ResolveRejection): string {
  switch (reason) {
    case "UNKNOWN_CLIENT":
      return "No application is registered with owneX for that client_id.";
    case "ORG_MISMATCH":
      return "The org_id does not match the organization this application is registered to.";
    case "SECRET_NOT_GENERATED":
      return "This application has no client secret yet, so it cannot exchange an authorization code.";
    default:
      // Every remaining value is a callback rejection.
      return explainCallbackRejection(reason);
  }
}
