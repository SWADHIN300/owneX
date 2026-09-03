import { z } from "zod";
import { handler, okNoStore, readJson, ApiError, notFound } from "@/lib/http";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/supabase";
import {
  RegistryUnavailableError,
  findApplicationBySlug,
  replaceCallbacks,
} from "@/lib/applications";
import { validateCallbackList } from "@/lib/callback-allowlist";

/**
 * PATCH /api/applications/<slug>
 *
 * Changing an integration's configuration, and revoking it.
 *
 * REVOKING IS NOT DELETING. `status = 'revoked'` makes `/authorize` and the code
 * exchange refuse the application immediately, but the row, its callbacks and
 * every audit event that referenced it stay exactly where they are. A compromised
 * integration has to be stoppable without destroying the record of what it did.
 *
 * Revocation is also not the same as withdrawing on-chain access. `setAppAccess`
 * is the admin's transaction and remains the authority over which roles may sign
 * in; this switch is the platform-side kill switch that works in one request.
 */

const paramsSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
});

const patchSchema = z
  .object({
    orgId: z.number().int().positive(),
    name: z.string().min(2).max(80).optional(),
    url: z.string().url().max(2048).optional(),
    description: z.string().max(500).nullable().optional(),
    logoUrl: z.string().url().max(2048).nullable().optional(),
    callbackUrls: z.array(z.string().min(8).max(2048)).min(1).max(10).optional(),
    allowedRoles: z.array(z.enum(["ADMIN", "MANAGER", "AUDITOR", "USER"])).min(1).max(4).optional(),
    status: z.enum(["active", "revoked"]).optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.url !== undefined ||
      body.description !== undefined ||
      body.logoUrl !== undefined ||
      body.callbackUrls !== undefined ||
      body.allowedRoles !== undefined ||
      body.status !== undefined,
    { message: "Nothing to change" },
  );

export const PATCH = handler(async (request: Request, context: { params: Promise<{ slug: string }> }) => {
  const { slug } = paramsSchema.parse(await context.params);
  const body = patchSchema.parse(await readJson(request));

  await requirePermission(body.orgId, "MANAGE_APPS");

  let existing;
  try {
    existing = await findApplicationBySlug(body.orgId, slug);
  } catch (error) {
    if (error instanceof RegistryUnavailableError) {
      throw new ApiError(503, "The application registry is unavailable", "REGISTRY_UNAVAILABLE");
    }
    throw error;
  }
  if (!existing) throw notFound("No such application in this organization");

  if (body.callbackUrls) {
    const problems = validateCallbackList(body.callbackUrls);
    if (problems.length > 0) {
      throw new ApiError(
        400,
        `Callback URL rejected — ${problems.join(" | ")}`,
        "CALLBACK_INVALID",
      );
    }
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.url !== undefined) patch.url = body.url;
  if (body.description !== undefined) patch.description = body.description;
  if (body.logoUrl !== undefined) patch.logo_url = body.logoUrl;
  if (body.allowedRoles !== undefined) patch.allowed_roles = body.allowedRoles;
  if (body.status !== undefined) patch.status = body.status;

  if (Object.keys(patch).length > 0) {
    const { error } = await db()
      .from("applications")
      .update(patch)
      .eq("org_id", body.orgId)
      .eq("app_slug", slug);
    if (error) throw new ApiError(500, `Could not update the application: ${error.message}`);
  }

  if (body.callbackUrls) {
    try {
      await replaceCallbacks(body.orgId, slug, body.callbackUrls);
    } catch (cause) {
      throw new ApiError(
        500,
        cause instanceof Error ? cause.message : "Could not save callback URLs",
        "CALLBACK_SAVE_FAILED",
      );
    }
  }

  const updated = await findApplicationBySlug(body.orgId, slug);

  return okNoStore({
    slug,
    orgId: body.orgId,
    status: updated?.status ?? existing.status,
    callbackUrls: updated?.callbacks ?? existing.callbacks,
    allowedRoles: updated?.allowedRoles ?? existing.allowedRoles,
    note:
      body.status === "revoked"
        ? "Sign-in through this integration is refused from now on. Audit history is untouched."
        : undefined,
  });
});
