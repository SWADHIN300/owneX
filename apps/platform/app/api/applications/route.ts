import { z } from "zod";
import { handler, okNoStore, badRequest, readJson, ApiError } from "@/lib/http";
import { requireMember, requirePermission } from "@/lib/authz";
import { db } from "@/lib/supabase";
import { hashApplicationRecord } from "@/lib/hash";
import { serverEnv } from "@/lib/env";
import { accessManager, appIdFromSlug, type RoleName } from "@/lib/chain";
import { readRoleAccess } from "@/lib/live-access";
import {
  ASSIGNABLE_ROLES,
  RegistryUnavailableError,
  findApplicationBySlug,
  listApplicationsForOrg,
  replaceCallbacks,
} from "@/lib/applications";
import { validateCallbackList } from "@/lib/callback-allowlist";
import { generateClientId, generateClientSecret, hashClientSecret } from "@/lib/client-credentials";
import { integrationEndpoints, integrationSteps, integrationStage } from "@/lib/integration";

/**
 * Applications — the registry behind "Sign in with OwneX".
 *
 * OwneX is a decentralised SSO and authorization layer: an approved website
 * redirects a visitor here, and gets back a role it can trust because the answer
 * was read from a contract rather than from a table somebody could edit.
 *
 * This route owns the half that *is* a table: name, homepage, logo, callbacks,
 * client credentials, status. Which roles may actually reach an application is
 * read from `OrgAccessManager` on every request and is never cached here.
 *
 * A website cannot register itself. Every row is created by an organization admin
 * holding MANAGE_APPS, verified on-chain, and the on-chain registration is a
 * transaction that admin signs — the server holds no key and cannot register
 * anything on anyone's behalf.
 */

const ROLES: RoleName[] = ASSIGNABLE_ROLES;

/* -------------------------------------------------------------------------- */
/* GET                                                                         */
/* -------------------------------------------------------------------------- */

const querySchema = z.object({
  orgId: z.coerce.number().int().positive(),
});

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) throw badRequest("orgId is required and must be a positive integer");

  const { orgId } = parsed.data;
  const caller = await requireMember(orgId);
  const canManage = caller.role === "ADMIN";

  let records;
  try {
    records = await listApplicationsForOrg(orgId);
  } catch (error) {
    if (error instanceof RegistryUnavailableError) {
      throw new ApiError(503, "The application registry is unavailable", "REGISTRY_UNAVAILABLE");
    }
    throw error;
  }

  const origin = serverEnv().APP_ORIGIN;
  const manager = accessManager();

  let applications;
  try {
    applications = await Promise.all(
      records.map(async (app) => {
        // Registration and per-role access both come from the chain. A row with no
        // matching registration is a draft, not an integration.
        const [registeredOnChain, access] = await Promise.all([
          manager.applicationRegistered(orgId, app.appId) as Promise<boolean>,
          readRoleAccess(orgId, app.appId),
        ]);

        const rolesAllowedOnChain = ROLES.filter((role) => access[role]).length;
        const stageInput = {
          registeredOnChain: Boolean(registeredOnChain),
          callbackCount: app.callbacks.length,
          hasClientSecret: app.clientSecretHash !== null,
          rolesAllowedOnChain,
          status: app.status,
        };

        return {
          slug: app.slug,
          appId: app.appId,
          name: app.name,
          url: app.url,
          description: app.description,
          logoUrl: app.logoUrl,
          status: app.status,
          registered: Boolean(registeredOnChain),
          // Whether the stored key matches what the slug hashes to. They can only
          // differ if a row was written by hand, but silently trusting the stored
          // value would hide exactly that.
          appIdMatchesSlug: (app.storedAppId ?? "").toLowerCase() === app.appId.toLowerCase(),
          access,
          callerHasAccess: access[caller.role as RoleName] ?? false,
          intendedRoles: app.allowedRoles,
          // Intent that was never signed on-chain. Worth naming rather than
          // leaving the admin to compare two lists by eye.
          rolesPendingOnChain: app.allowedRoles.filter((role) => !access[role]),
          stage: integrationStage(stageInput),
          steps: integrationSteps(stageInput),
          // Integration configuration is management detail. An ordinary member can
          // see that an application exists and whether their role may use it, but
          // not the values that wire a partner backend up.
          clientId: canManage ? app.clientId : null,
          callbackUrls: canManage ? app.callbacks : null,
          hasClientSecret: canManage ? app.clientSecretHash !== null : null,
          clientSecretUpdatedAt: canManage ? app.clientSecretUpdatedAt : null,
          endpoints: canManage
            ? integrationEndpoints({
                origin,
                clientId: app.clientId,
                orgId,
                slug: app.slug,
                redirectUri: app.callbacks[0] ?? null,
              })
            : null,
        };
      }),
    );
  } catch (error) {
    // The chain is the authority on access. If it cannot be read, this screen
    // must not render a guess.
    console.error("[ownex] could not read application access on-chain:", error);
    throw new ApiError(
      503,
      "Could not read application access from the chain",
      "CHAIN_UNAVAILABLE",
    );
  }

  return okNoStore({
    orgId,
    count: applications.length,
    callerRole: caller.role,
    canManage,
    applications,
  });
});

/* -------------------------------------------------------------------------- */
/* POST                                                                        */
/* -------------------------------------------------------------------------- */

const slugSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Lowercase letters, digits and hyphens only");

const roleSchema = z.enum(["ADMIN", "MANAGER", "AUDITOR", "USER"]);

const registrationSchema = z.object({
  orgId: z.number().int().positive(),
  // The slug is the identity of the application: keccak256 of it is the on-chain
  // key, so it is constrained to something that cannot be mistyped into a
  // different application by accident.
  slug: slugSchema,
  name: z.string().min(2).max(80),
  url: z.string().url().max(2048),
  description: z.string().max(500).optional(),
  logoUrl: z.string().url().max(2048).optional(),
  callbackUrls: z.array(z.string().min(8).max(2048)).min(1).max(10),
  allowedRoles: z.array(roleSchema).min(1).max(4),
});

/**
 * POST /api/applications
 *
 * Saves the integration record, issues client credentials the first time, and
 * returns what `registerApplication` needs. The registration itself is the
 * admin's transaction — this endpoint cannot grant anybody access to anything.
 *
 * The plaintext client secret is in this response and nowhere else, ever again.
 */
export const POST = handler(async (request: Request) => {
  const body = registrationSchema.parse(await readJson(request));

  await requirePermission(body.orgId, "MANAGE_APPS");

  const problems = validateCallbackList(body.callbackUrls);
  if (problems.length > 0) {
    throw new ApiError(400, `Callback URL rejected — ${problems.join(" | ")}`, "CALLBACK_INVALID");
  }

  const appId = appIdFromSlug(body.slug);
  const metadataHash = hashApplicationRecord({
    slug: body.slug,
    name: body.name,
    url: body.url,
  });

  let existing;
  try {
    existing = await findApplicationBySlug(body.orgId, body.slug);
  } catch (error) {
    if (error instanceof RegistryUnavailableError) {
      throw new ApiError(503, "The application registry is unavailable", "REGISTRY_UNAVAILABLE");
    }
    throw error;
  }

  // Credentials are issued once. Re-submitting the form to change a callback must
  // not silently rotate a secret the partner is already running with.
  const clientId = existing?.clientId ?? generateClientId();
  const issueSecret = !existing?.clientSecretHash;
  const clientSecret = issueSecret ? generateClientSecret() : null;

  const { error } = await db()
    .from("applications")
    .upsert(
      {
        org_id: body.orgId,
        app_slug: body.slug,
        app_id: appId,
        name: body.name,
        url: body.url,
        description: body.description ?? null,
        logo_url: body.logoUrl ?? null,
        client_id: clientId,
        ...(clientSecret
          ? {
              client_secret_hash: hashClientSecret(clientSecret),
              client_secret_updated_at: new Date().toISOString(),
            }
          : {}),
        allowed_roles: body.allowedRoles,
        // Re-registering an application that an admin revoked does not quietly
        // un-revoke it; that is a separate, deliberate action.
        status: existing?.status === "revoked" ? "revoked" : "active",
      },
      { onConflict: "org_id,app_slug" },
    );

  if (error) throw new ApiError(500, `Could not save the application: ${error.message}`);

  try {
    await replaceCallbacks(body.orgId, body.slug, body.callbackUrls);
  } catch (cause) {
    throw new ApiError(
      500,
      cause instanceof Error ? cause.message : "Could not save callback URLs",
      "CALLBACK_SAVE_FAILED",
    );
  }

  return okNoStore({
    slug: body.slug,
    appId,
    metadataHash,
    registerArgs: { orgId: body.orgId, appId, metadataHash },
    clientId,
    /** Present exactly once, at issue time. Never retrievable afterwards. */
    clientSecret,
    callbackUrls: body.callbackUrls,
    allowedRoles: body.allowedRoles,
    accessArgs: body.allowedRoles.map((role) => ({ orgId: body.orgId, appId, role })),
    endpoints: integrationEndpoints({
      origin: serverEnv().APP_ORIGIN,
      clientId,
      orgId: body.orgId,
      slug: body.slug,
      redirectUri: body.callbackUrls[0],
    }),
  });
});
