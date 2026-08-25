import { z } from "zod";
import { handler, okNoStore, readJson, ApiError } from "@/lib/http";
import { requireCaller } from "@/lib/authz";
import { db, normalizeAddress } from "@/lib/supabase";
import { encryptPII, decryptPII } from "@/lib/crypto";
import { hashIdentityRecord } from "@/lib/hash";
import { readIdentity } from "@/lib/chain";

/**
 * GET /api/profile  — the caller's own profile
 * PUT /api/profile  — create or update it
 *
 * A user may only ever read or write their own profile: the wallet comes from
 * the session cookie and there is no parameter to point this at anyone else.
 *
 * PUT returns `identityHash`, which the client then anchors on-chain via
 * `registerIdentity(hash)` or `updateIdentityHash(hash)`. Until that
 * transaction lands, the profile exists but is unanchored — the response says
 * so explicitly so the UI can prompt for the signature.
 */

const profileSchema = z.object({
  displayName: z.string().min(2).max(80),
  jobTitle: z.string().max(80).optional(),
  department: z.string().max(80).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  avatarUrl: z.string().url().optional(),
});

export const GET = handler(async () => {
  const { wallet } = await requireCaller();

  const { data } = await db()
    .from("profiles")
    .select("display_name, job_title, department, email_encrypted, phone_encrypted, avatar_url, identity_hash, created_at")
    .eq("wallet_address", normalizeAddress(wallet))
    .maybeSingle();

  if (!data) return okNoStore({ wallet, profile: null });

  return okNoStore({
    wallet,
    profile: {
      displayName: data.display_name,
      jobTitle: data.job_title,
      department: data.department,
      email: decryptPII(data.email_encrypted),
      phone: decryptPII(data.phone_encrypted),
      avatarUrl: data.avatar_url,
      identityHash: data.identity_hash,
      createdAt: data.created_at,
    },
  });
});

export const PUT = handler(async (request: Request) => {
  const { wallet } = await requireCaller();
  const body = profileSchema.parse(await readJson(request));

  const identityHash = hashIdentityRecord({
    displayName: body.displayName,
    email: body.email,
    phone: body.phone,
    jobTitle: body.jobTitle,
    department: body.department,
  });

  const { error } = await db()
    .from("profiles")
    .upsert(
      {
        wallet_address: normalizeAddress(wallet),
        display_name: body.displayName,
        job_title: body.jobTitle ?? null,
        department: body.department ?? null,
        email_encrypted: encryptPII(body.email),
        phone_encrypted: encryptPII(body.phone),
        avatar_url: body.avatarUrl ?? null,
        identity_hash: identityHash,
      },
      { onConflict: "wallet_address" }
    );

  if (error) throw new ApiError(500, `Could not save profile: ${error.message}`);

  const identity = await readIdentity(wallet);
  const anchored = identity.identityHash?.toLowerCase() === identityHash.toLowerCase();

  return okNoStore({
    wallet,
    identityHash,
    anchored,
    nextStep: anchored
      ? null
      : identity.registered
        ? { call: "updateIdentityHash", args: [identityHash] }
        : { call: "registerIdentity", args: [identityHash] },
    note: anchored
      ? "Profile saved and matches the on-chain anchor."
      : "Profile saved. Sign the returned call to anchor it on-chain.",
  });
});
