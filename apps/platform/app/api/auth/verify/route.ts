import { z } from "zod";
import { handler, okNoStore, readJson, ApiError } from "@/lib/http";
import { verifyChallenge } from "@/lib/siwe";
import { createSession } from "@/lib/session";
import { serverEnv } from "@/lib/env";
import { db, normalizeAddress } from "@/lib/supabase";
import { readIdentity, readMemberships } from "@/lib/chain";

const bodySchema = z.object({
  message: z.string().min(50),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

/**
 * POST /api/auth/verify
 *
 * Step 2 of login. Verifies the signature, consumes the nonce, and issues an
 * httpOnly session cookie.
 *
 * The response includes the caller's on-chain state so the UI can route them
 * straight to the right dashboard — but note the session itself stores only the
 * wallet. Roles are re-read from the chain on every subsequent request.
 */
export const POST = handler(async (request: Request) => {
  const body = bodySchema.parse(await readJson(request));

  const result = await verifyChallenge(body);
  if (!result.ok) throw new ApiError(401, result.reason, "SIGNATURE_REJECTED");

  const wallet = result.address;
  await createSession(wallet, serverEnv().CHAIN_ID);

  const [identity, memberships] = await Promise.all([readIdentity(wallet), readMemberships(wallet)]);

  // Off-chain display name, if this wallet has a profile yet.
  const { data: profile } = await db()
    .from("profiles")
    .select("display_name, job_title, department, avatar_url")
    .eq("wallet_address", normalizeAddress(wallet))
    .maybeSingle();

  return okNoStore({
    wallet,
    identity: {
      registered: identity.registered,
      active: identity.active,
      identityHash: identity.identityHash,
    },
    memberships,
    profile: profile ?? null,
    // Where the client should go next.
    next: !identity.registered ? "onboarding" : memberships.length === 0 ? "no-organization" : "dashboard",
  });
});
