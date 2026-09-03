import { NextResponse } from "next/server";
import { z } from "zod";

import { sessionWallet } from "@/lib/session";
import {
  RegistryUnavailableError,
  resolveAuthorizationRequest,
} from "@/lib/applications";
import { buildCallbackRedirect } from "@/lib/callback-allowlist";
import { evaluateLiveAccess } from "@/lib/live-access";
import { issueAuthorizationCode } from "@/lib/authorize";
import { supabaseCodeStore } from "@/lib/authorize-store";

/**
 * POST /api/authorize/approve — the consent submission.
 *
 * NOTHING FROM THE FORM IS TRUSTED. The consent page already validated the
 * client, the organization, the callback and the caller's live role, and every one
 * of those checks is repeated here from scratch. A form post is just another
 * request: an attacker can craft one directly, and the state of the chain can have
 * changed between rendering the page and pressing the button.
 *
 * Cross-site submission is separately foreclosed by the session cookie being
 * `sameSite: "lax"`, which a browser does not attach to a cross-site POST. Such a
 * request therefore arrives with no wallet and is refused.
 *
 * The redirect target is always the REGISTERED callback, never the submitted one.
 */

const formSchema = z.object({
  client_id: z.string().min(8).max(128),
  org_id: z.coerce.number().int().positive(),
  redirect_uri: z.string().min(8).max(2048),
  state: z.string().min(8).max(512),
});

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new NextResponse("Malformed consent submission", { status: 400 });
  }

  const parsed = formSchema.safeParse({
    client_id: form.get("client_id"),
    org_id: form.get("org_id"),
    redirect_uri: form.get("redirect_uri"),
    state: form.get("state"),
  });

  // Before the callback is proven to belong to a registered application there is
  // nowhere safe to redirect to, so these failures are plain responses. Redirecting
  // an unvalidated URI would be an open redirect on the identity provider itself.
  if (!parsed.success) {
    return new NextResponse("Invalid authorization request", { status: 400 });
  }

  const { client_id: clientId, org_id: orgId, redirect_uri: redirectUri, state } = parsed.data;

  let resolved;
  try {
    resolved = await resolveAuthorizationRequest({ clientId, orgId, redirectUri });
  } catch (error) {
    if (error instanceof RegistryUnavailableError) {
      return new NextResponse("The application registry is unavailable", { status: 503 });
    }
    throw error;
  }

  if (!resolved.ok) {
    return new NextResponse(`Authorization refused: ${resolved.reason}`, { status: 400 });
  }

  const { application, registeredCallback } = resolved;
  const redirectTo = (params: { code?: string; error?: string }) =>
    NextResponse.redirect(buildCallbackRedirect(registeredCallback, { ...params, state }), 303);

  const wallet = await sessionWallet();
  if (!wallet) return redirectTo({ error: "access_denied" });

  const access = await evaluateLiveAccess({ orgId, wallet, appSlug: application.slug });

  // Fail closed: an unreadable chain is a refusal, not a default approval. The
  // partner sees a temporary error rather than a code it should not have.
  if (!access.ok) return redirectTo({ error: "temporarily_unavailable" });
  if (!access.decision.allowed) return redirectTo({ error: "access_denied" });

  try {
    const { code } = await issueAuthorizationCode(
      {
        clientId,
        appSlug: application.slug,
        orgId,
        wallet,
        // Bound to the registered callback, so the exchange must present the same
        // one. A code issued for one callback cannot be redeemed against another.
        redirectUri: registeredCallback,
      },
      supabaseCodeStore(),
    );
    return redirectTo({ code });
  } catch (error) {
    console.error("[ownex] could not issue an authorization code:", error);
    return redirectTo({ error: "temporarily_unavailable" });
  }
}
