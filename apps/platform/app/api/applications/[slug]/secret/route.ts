import { z } from "zod";
import { handler, okNoStore, readJson, ApiError, notFound } from "@/lib/http";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/supabase";
import { serverEnv } from "@/lib/env";
import { RegistryUnavailableError, findApplicationBySlug } from "@/lib/applications";
import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
} from "@/lib/client-credentials";
import { integrationEndpoints } from "@/lib/integration";

/**
 * POST /api/applications/<slug>/secret — rotate the client secret.
 *
 * Rotation is the answer to "the secret leaked" and to "the secret was never
 * written down". Both need the same thing: a new random value, stored only as a
 * digest, shown exactly once.
 *
 * The old secret stops working the moment this returns, which is the point. There
 * is no overlap window, because a leaked secret that keeps working for an hour is
 * a leaked secret. The client id is unchanged, so the partner only has to update
 * one environment variable.
 */

const paramsSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
});

const bodySchema = z.object({
  orgId: z.number().int().positive(),
  /** Typed by the admin to confirm they understand the old secret will stop working. */
  confirm: z.literal(true),
});

export const POST = handler(
  async (request: Request, context: { params: Promise<{ slug: string }> }) => {
    const { slug } = paramsSchema.parse(await context.params);
    const body = bodySchema.parse(await readJson(request));

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

    const clientId = existing.clientId ?? generateClientId();
    const clientSecret = generateClientSecret();

    const { error } = await db()
      .from("applications")
      .update({
        client_id: clientId,
        client_secret_hash: hashClientSecret(clientSecret),
        client_secret_updated_at: new Date().toISOString(),
      })
      .eq("org_id", body.orgId)
      .eq("app_slug", slug);

    if (error) throw new ApiError(500, `Could not rotate the secret: ${error.message}`);

    return okNoStore({
      slug,
      orgId: body.orgId,
      clientId,
      /** Present exactly once. Not stored, not recoverable. */
      clientSecret,
      rotatedAt: new Date().toISOString(),
      endpoints: integrationEndpoints({
        origin: serverEnv().APP_ORIGIN,
        clientId,
        orgId: body.orgId,
        slug,
        redirectUri: existing.callbacks[0] ?? null,
      }),
      warning:
        "Store this value in the partner application's server environment now. The previous secret has already stopped working, and this one cannot be shown again.",
    });
  },
);
