/**
 * Integration metadata — what an admin has to copy into a partner codebase, and
 * how far along the wiring is.
 *
 * Pure, so the same values are produced by the API (for the "copy integration
 * details" panel) and by the tests, and so the stage pipeline shown in the
 * dashboard cannot drift from the conditions the authorization endpoint actually
 * enforces.
 */

export const INTEGRATION_ENV_VARS = {
  origin: "OWNEX_ORIGIN",
  clientId: "OWNEX_CLIENT_ID",
  clientSecret: "OWNEX_CLIENT_SECRET",
  orgId: "OWNEX_ORG_ID",
  redirectUri: "OWNEX_REDIRECT_URI",
} as const;

export type IntegrationEndpoints = {
  /** Where the partner sends the browser. `state` is the partner's to generate. */
  authorizeUrl: string;
  /** Server-to-server code exchange. Requires the client secret. */
  exchangeUrl: string;
  /** Live revalidation for every subsequent request the partner serves. */
  verifyUrl: string;
  /** The exact names of the environment variables the partner needs. */
  envVars: typeof INTEGRATION_ENV_VARS;
};

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function integrationEndpoints(params: {
  origin: string;
  clientId: string | null;
  orgId: number;
  slug: string;
  redirectUri?: string | null;
}): IntegrationEndpoints {
  const origin = trimOrigin(params.origin);
  const authorize = new URL("/authorize", `${origin}/`);
  authorize.searchParams.set("client_id", params.clientId ?? `<${INTEGRATION_ENV_VARS.clientId}>`);
  authorize.searchParams.set("org_id", String(params.orgId));
  authorize.searchParams.set(
    "redirect_uri",
    params.redirectUri ?? `<${INTEGRATION_ENV_VARS.redirectUri}>`,
  );
  authorize.searchParams.set("state", "<random-per-request-state>");

  const verify = new URL("/api/roles/verify", `${origin}/`);
  verify.searchParams.set("wallet", "<wallet>");
  verify.searchParams.set("orgId", String(params.orgId));
  verify.searchParams.set("app", params.slug);

  return {
    authorizeUrl: authorize.toString(),
    exchangeUrl: `${origin}/api/authorize/exchange`,
    verifyUrl: verify.toString(),
    envVars: INTEGRATION_ENV_VARS,
  };
}

/* -------------------------------------------------------------------------- */
/* Status pipeline                                                             */
/* -------------------------------------------------------------------------- */

export type IntegrationStage = "draft" | "registered" | "callback" | "secret" | "active";

export const INTEGRATION_STAGE_LABEL: Record<IntegrationStage, string> = {
  draft: "Draft",
  registered: "Registered on-chain",
  callback: "Callback configured",
  secret: "Secret generated",
  active: "Active",
};

export type IntegrationStep = {
  key: IntegrationStage;
  label: string;
  done: boolean;
  /** What the admin has to do when this step is not done. */
  todo: string;
};

export type IntegrationInput = {
  /** True when `applicationRegistered(orgId, appId)` answered true. */
  registeredOnChain: boolean;
  callbackCount: number;
  hasClientSecret: boolean;
  /** Roles the chain currently allows through `appAccessForRole`. */
  rolesAllowedOnChain: number;
  status: "draft" | "active" | "revoked" | string;
};

/**
 * The five states from the Applications screen, in order.
 *
 * "Active" is the conjunction of the four before it, plus a role that may
 * actually sign in — which is the same set of conditions `/authorize` checks. A
 * pipeline that showed Active while `canAccessApp` returned false for every role
 * would be a dashboard telling a comfortable lie.
 */
export function integrationSteps(input: IntegrationInput): IntegrationStep[] {
  const revoked = input.status === "revoked";
  const registered = input.registeredOnChain && !revoked;
  const callback = registered && input.callbackCount > 0;
  const secret = callback && input.hasClientSecret;
  const active = secret && input.rolesAllowedOnChain > 0 && !revoked;

  return [
    {
      key: "draft",
      label: INTEGRATION_STAGE_LABEL.draft,
      done: true,
      todo: "",
    },
    {
      key: "registered",
      label: INTEGRATION_STAGE_LABEL.registered,
      done: registered,
      todo: "An admin must sign registerApplication(orgId, appId, metadataHash).",
    },
    {
      key: "callback",
      label: INTEGRATION_STAGE_LABEL.callback,
      done: callback,
      todo: "Add at least one exact callback URL.",
    },
    {
      key: "secret",
      label: INTEGRATION_STAGE_LABEL.secret,
      done: secret,
      todo: "Generate a client secret and store it in the partner's backend.",
    },
    {
      key: "active",
      label: INTEGRATION_STAGE_LABEL.active,
      done: active,
      todo: revoked
        ? "This integration is revoked. Restore it to allow sign-in again."
        : "Grant at least one role access on-chain with setAppAccess.",
    },
  ];
}

/** The furthest stage reached. `draft` when nothing beyond the record exists. */
export function integrationStage(input: IntegrationInput): IntegrationStage {
  const steps = integrationSteps(input);
  let stage: IntegrationStage = "draft";
  for (const step of steps) {
    if (!step.done) break;
    stage = step.key;
  }
  return stage;
}
