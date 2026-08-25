import { z } from "zod";
import { handler, okNoStore, readJson } from "@/lib/http";
import { issueChallenge } from "@/lib/siwe";

const bodySchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "wallet must be a 0x address"),
});

/**
 * POST /api/auth/nonce
 *
 * Step 1 of login. Returns a single-use challenge for the wallet to sign.
 * The address in the body is untrusted at this point — it only determines who
 * the challenge is issued to. Nothing is authorized until /verify recovers a
 * signature back to it.
 */
export const POST = handler(async (request: Request) => {
  const body = bodySchema.parse(await readJson(request));
  const challenge = await issueChallenge(body.wallet);

  return okNoStore({
    nonce: challenge.nonce,
    message: challenge.message,
    expiresAt: challenge.expiresAt,
    gasRequired: false,
  });
});
