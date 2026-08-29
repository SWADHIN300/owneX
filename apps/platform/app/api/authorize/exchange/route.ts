import { z } from "zod";
import { handler, okNoStore, ApiError, readJson } from "@/lib/http";
import { consumeGrant, validRedirect } from "@/lib/authorize";

const exchangeSchema = z.object({
  code: z.string().min(32),
  app: z.literal("employee-portal"),
  redirect_uri: z.string().url(),
  client_secret: z.string().min(10),
});

export const POST = handler(async (req: Request) => {
  const body = exchangeSchema.parse(await readJson(req));
  const expectedSecret = process.env.PORTAL_CLIENT_SECRET ?? "employee-portal-local-secret";

  if (body.client_secret !== expectedSecret || !validRedirect(body.app, body.redirect_uri)) {
    throw new ApiError(401, "Invalid client or redirect");
  }

  const grant = await consumeGrant(body.code, body.app, body.redirect_uri);
  if (!grant) {
    throw new ApiError(
      400,
      "Authorization code is invalid, expired, or already used",
      "CODE_REJECTED"
    );
  }

  return okNoStore({
    wallet: grant.wallet,
    app: grant.app,
  });
});
