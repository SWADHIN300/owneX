import {
  RegistryUnavailableError,
  findApplicationByClientId,
  type RegisteredApplication,
} from "./applications";
import { verifyClientSecret } from "./client-credentials";
import { readPartnerCredentials, requiresClientAuth } from "./partner-credentials";

/**
 * Authenticating a partner *application* (as opposed to a user).
 *
 * `/api/roles/verify` is the endpoint a partner calls on every request it serves,
 * so it needs a caller identity that is not a browser session. The credential is
 * the same client id and secret used for the code exchange — one secret per
 * integration, revocable in one place, with nothing extra to manage.
 *
 * Accepted forms, both server-to-server only:
 *   Authorization: Basic base64(client_id ":" client_secret)
 *   X-OwneX-Client-Id / X-OwneX-Client-Secret
 *
 * DEVELOPMENT-ONLY PUBLIC MODE
 *   Outside production an unauthenticated call is answered, because the endpoint
 *   reveals only what is already public on-chain and a local integration is much
 *   easier to build that way. In production it is refused — see
 *   `requiresClientAuth`, which has no override.
 */

export type PartnerAuth =
  | { ok: true; mode: "credentials"; application: RegisteredApplication }
  | { ok: true; mode: "development-public"; application: null }
  | { ok: false; status: 401 | 503; code: string; message: string };

export async function authenticatePartner(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<PartnerAuth> {
  const credentials = readPartnerCredentials(request.headers);

  if (!credentials) {
    if (requiresClientAuth(env)) {
      return {
        ok: false,
        status: 401,
        code: "CLIENT_AUTH_REQUIRED",
        message:
          "Present your owneX client credentials, either as HTTP Basic auth or as X-OwneX-Client-Id and X-OwneX-Client-Secret headers. Never from browser JavaScript.",
      };
    }
    return { ok: true, mode: "development-public", application: null };
  }

  let application: RegisteredApplication | null;
  try {
    application = await findApplicationByClientId(credentials.clientId);
  } catch (error) {
    if (error instanceof RegistryUnavailableError) {
      return {
        ok: false,
        status: 503,
        code: "REGISTRY_UNAVAILABLE",
        message: "Could not verify your client credentials right now.",
      };
    }
    throw error;
  }

  // Verified regardless of whether the application exists, so response timing does
  // not distinguish an unknown client id from a wrong secret.
  const secretOk = verifyClientSecret(
    credentials.clientSecret,
    application?.clientSecretHash ?? null,
  );

  if (!application || application.status === "revoked" || !secretOk) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_CLIENT",
      message: "Invalid client credentials.",
    };
  }

  return { ok: true, mode: "credentials", application };
}
