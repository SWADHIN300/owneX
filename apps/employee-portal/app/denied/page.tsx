import Link from "next/link";

/**
 * Every reason code owneX or this portal can produce, in plain language.
 *
 * An unmapped code still renders, with the code shown, because an unexplained
 * denial is impossible to support.
 */
const messages: Record<string, string> = {
  // Access decisions from owneX
  ORGANIZATION_NOT_FOUND: "That organization could not be found on-chain.",
  ORGANIZATION_SUSPENDED: "This organization is currently suspended.",
  IDENTITY_NOT_REGISTERED: "This wallet has no registered owneX identity.",
  IDENTITY_REVOKED: "This identity has been revoked. Ask an administrator to reactivate it.",
  NOT_A_MEMBER: "You are not a member of this organization.",
  ROLE_EXPIRED: "Your role has expired. Ask an administrator to renew it.",
  APP_ACCESS_NOT_GRANTED:
    "Your role is valid, but this application has not been enabled for it on-chain.",
  APPLICATION_NOT_REGISTERED:
    "This portal is not registered on-chain for that organization yet.",
  APPLICATION_REVOKED: "An administrator has revoked this integration.",
  ACCESS_DENIED: "The authorization request was declined.",

  // Protocol-level failures
  INVALID_STATE:
    "The sign-in could not be matched to a request this portal made. Start again from the home page.",
  INVALID_CODE: "owneX did not return an authorization code.",
  CODE_REJECTED:
    "The authorization code had expired or had already been used. Codes are valid for two minutes and once only.",
  INVALID_CLIENT: "This portal's owneX credentials were rejected.",
  ORG_MISMATCH: "owneX returned an organization this portal is not configured for.",
  TEMPORARILY_UNAVAILABLE: "owneX could not complete the check. Please try again shortly.",
  CHAIN_UNAVAILABLE:
    "owneX could not read the blockchain, so your access could not be confirmed. Access is denied until it can.",
  VERIFICATION_UNAVAILABLE:
    "owneX could not be reached to confirm your access, so this portal denied it.",
  PORTAL_NOT_CONFIGURED:
    "This portal is missing its owneX client credentials. An administrator needs to set OWNEX_CLIENT_ID and OWNEX_CLIENT_SECRET.",
  AUTHORIZATION_FAILED: "The authorization response was not valid.",
};

export default async function Denied({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const code = reason ?? "UNKNOWN";

  return (
    <main className="wrap">
      <div className="hero">
        <div className="eyebrow">Access decision</div>
        <h1>We could not open your workspace.</h1>
        <div className="error">
          <strong>{messages[code] ?? "The authorization request was not completed."}</strong>
          <p className="muted">Reason code: {code}</p>
        </div>
        <Link className="button secondary" href="/">
          Return home
        </Link>
      </div>
    </main>
  );
}
