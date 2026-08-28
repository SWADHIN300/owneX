import { z } from "zod";
import { handler, okNoStore, badRequest, readJson, ApiError } from "@/lib/http";
import { requireMember, requirePermission } from "@/lib/authz";
import { db } from "@/lib/supabase";
import { hashApplicationRecord } from "@/lib/hash";
import { accessManager, appIdFromSlug, roleHash, type RoleName } from "@/lib/chain";

/**
 * GET /api/applications?orgId=1 — applications wired into single sign-on
 *
 * This is the layer that makes owneX an identity provider rather than a
 * dashboard: an application registered here can ask `/api/roles/verify` who a
 * wallet is and what it may do, without holding any blockchain code of its own.
 *
 * Which roles may reach an application is read from the contract, not from the
 * database. The database only holds the display half — name, URL, logo — because
 * an access answer that could be edited in Postgres would not be worth asking
 * for.
 */

const querySchema = z.object({
  orgId: z.coerce.number().int().positive(),
});

const ROLES: RoleName[] = ["ADMIN", "MANAGER", "AUDITOR", "USER"];

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) throw badRequest("orgId is required and must be a positive integer");

  const { orgId } = parsed.data;

  const caller = await requireMember(orgId);

  const { data: rows } = await db()
    .from("applications")
    .select("app_slug, app_id, name, url, description, logo_url, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  const manager = accessManager();

  const applications = await Promise.all(
    (rows ?? []).map(async (row) => {
      const appId = appIdFromSlug(String(row.app_slug));

      // Registration and per-role access both come from the chain. A row in the
      // database with no matching registration is a draft, not an integration.
      const [registered, accessEntries] = await Promise.all([
        manager.applicationRegistered(orgId, appId) as Promise<boolean>,
        Promise.all(
          ROLES.map(
            async (role) =>
              [
                role,
                Boolean(await manager.appAccessForRole(orgId, appId, roleHash(role))),
              ] as const,
          ),
        ),
      ]);

      return {
        slug: String(row.app_slug),
        appId,
        name: row.name,
        url: row.url,
        description: row.description,
        logoUrl: row.logo_url,
        registered,
        // Whether the on-chain key matches what the slug hashes to. They can
        // only differ if a row was written by hand, but silently trusting the
        // stored value would hide exactly that.
        appIdMatchesSlug: String(row.app_id).toLowerCase() === appId.toLowerCase(),
        access: Object.fromEntries(accessEntries) as Record<RoleName, boolean>,
        callerHasAccess:
          accessEntries.find(([role]) => role === caller.role)?.[1] ?? false,
      };
    }),
  );

  return okNoStore({
    orgId,
    count: applications.length,
    callerRole: caller.role,
    // Registering an application or changing its access needs MANAGE_APPS,
    // checked on-chain when the transaction runs. This only decides what the
    // interface offers.
    canManage: caller.role === "ADMIN",
    applications,
  });
});

/* -------------------------------------------------------------------------- */
/* POST                                                                        */
/* -------------------------------------------------------------------------- */

const draftSchema = z.object({
  orgId: z.number().int().positive(),
  // The slug is the identity of the application: keccak256 of it is the on-chain
  // key, so it is constrained to something that cannot be mistyped into a
  // different application by accident.
  slug: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Lowercase letters, digits and hyphens only"),
  name: z.string().min(2).max(80),
  url: z.string().url(),
  description: z.string().max(500).optional(),
});

/**
 * POST /api/applications
 *
 * Saves the display record and returns what `registerApplication` needs. The
 * registration itself is the admin's transaction — this endpoint cannot grant
 * anybody access to anything, which is why it only requires MANAGE_APPS to be
 * plausible rather than proven here: the contract proves it when the transaction
 * runs.
 */
export const POST = handler(async (request: Request) => {
  const body = draftSchema.parse(await readJson(request));

  await requirePermission(body.orgId, "MANAGE_APPS");

  const appId = appIdFromSlug(body.slug);
  const metadataHash = hashApplicationRecord({
    slug: body.slug,
    name: body.name,
    url: body.url,
  });

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
      },
      { onConflict: "org_id,app_slug" },
    );

  if (error) throw new ApiError(500, `Could not save the application: ${error.message}`);

  return okNoStore({
    slug: body.slug,
    appId,
    metadataHash,
    registerArgs: { orgId: body.orgId, appId, metadataHash },
  });
});
