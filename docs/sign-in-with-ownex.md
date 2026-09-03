# Sign in with OwneX

OwneX is a decentralised SSO and authorization layer. An **approved** third-party
website redirects a visitor to OwneX for wallet authentication, and OwneX returns a
temporary authorization code only after checking that visitor's active identity,
live organizational role and application permission **on-chain**. The partner
website never handles a private key, a seed phrase or any blockchain logic.

> **External applications must be registered and approved.** There is no
> self-service signup and no public client registration. A website can only use
> OwneX because an organization administrator, holding `MANAGE_APPS` verified
> on-chain, registered it and signed a `registerApplication` transaction. An
> arbitrary website has no client id, and without a client id `/authorize` refuses
> the request before rendering anything.

---

## 1. The flow

```
Partner site                     OwneX platform                    Chain
     │                                  │                            │
 1.  ├── GET /authorize?client_id=…&org_id=…&redirect_uri=…&state=… ─▶│
     │                                  │                            │
 2.  │                   wallet sign-in (SIWE, no gas) ───────────────┤
     │                                  │                            │
 3.  │                   read identity, org, membership, role,        │
     │                   canAccessApp ─────────────────────────────▶ │
     │                                  │                            │
 4.  │                   consent screen, then issue a code           │
     │◀── 303 redirect_uri?code=…&state=… ──                         │
     │                                  │                            │
 5.  ├── POST /api/authorize/exchange (backend, with client secret) ─▶│
     │◀── { wallet, orgId, role, permissions, identityActive, … } ──  │
     │                                  │                            │
 6.  ├── GET /api/roles/verify on every later request ──────────────▶│
```

Steps 1 and 4 travel through the browser. Steps 5 and 6 are server-to-server and
require the client secret. That separation is what makes the code safe to put in a
URL: without the secret, a stolen code is inert.

---

## 2. Security model and privacy boundaries

### What the partner receives

The exchange endpoint returns exactly this, and nothing else:

```json
{
  "wallet": "0xabc…",
  "orgId": 1,
  "role": "MANAGER",
  "permissions": { "VIEW_AUDIT": true, "MINT_ASSETS": false },
  "identityActive": true,
  "verifiedAt": "2026-01-01T12:00:00.000Z"
}
```

### What the partner never receives

Private keys, seed phrases and signatures — OwneX never holds them either; the
user signs in their own wallet. Also: email address, phone number, display name,
job title, department, avatar, asset descriptions, serial numbers, invoice
references and private documents. Those live encrypted in the OwneX database and
are visible only inside the OwneX console to a role permitted to see them.

This is enforced in code rather than by convention:
`lib/access-decision.ts` builds the response from a fixed list of six keys, and
`lib/access-decision.test.ts` asserts that no field from `FORBIDDEN_CLAIM_KEYS`
can appear in it.

### Where authority lives

| Question | Answered by |
| --- | --- |
| Is this website allowed to use OwneX at all? | `applications` row created by an admin |
| Which URL may receive a code? | `application_callbacks`, exact match |
| Is this wallet a real, active identity? | `IdentityRegistry` |
| Is this organization active? | `IdentityRegistry` |
| What role applies right now? | `OrgAccessManager.effectiveRole` |
| May that role use this application? | `OrgAccessManager.canAccessApp` |

Nothing in the database decides who may sign in. `allowed_roles` on an
application row records only what an admin *intended*; the dashboard shows an
intention that has no matching `setAppAccess` transaction so the difference cannot
hide.

### Guarantees

- **Authorization codes** are 32 random bytes, valid for **two minutes**, and
  single-use. Consumption is one conditional `UPDATE … WHERE used_at IS NULL`
  returning the changed row, so of two simultaneous exchanges exactly one
  succeeds. Each code is bound to its client id, organization, wallet and exact
  redirect URI.
- **Client secrets** are 256 random bits, stored only as a salted scrypt digest,
  compared in constant time. There is no fallback value: an application with no
  stored digest cannot authenticate at all.
- **Callback URLs** are matched exactly, after safe canonicalisation (lowercase
  scheme and host, default port dropped, one trailing slash dropped). No
  wildcards, no subdomain patterns, no substring matching, no path allow-list.
- **HTTPS** is required for every callback that is not on loopback. A loopback
  callback is accepted in development only, so a stale `localhost` value in a
  production deployment is refused rather than honoured.
- **Open redirects** are structurally impossible: every redirect is built by
  `buildCallbackRedirect` from the **registered** callback, never from the
  `redirect_uri` in the request, and carries only `code`/`error` and `state`.
- **Fail closed.** If the chain or the database cannot be read, the answer is a
  denial or a `503`. No code path produces `allowed: true` from an incomplete
  read.
- **Revocation is immediate.** The role is never cached in a cookie or in the
  code. It is re-read from the contract at consent, at exchange, and on every
  `/api/roles/verify` call.
- **Sessions** are encrypted, `httpOnly`, `sameSite=lax` cookies, `Secure` in
  production. Because the cookie is `sameSite=lax`, a cross-site POST to the
  consent endpoint arrives with no session and is refused.
- **SIWE** is unchanged: server-generated single-use nonce, five-minute expiry,
  domain and chain-id binding, signature recovered to the claimed address, nonce
  consumed atomically.

---

## 3. Registering a partner website

An organization administrator does this once, on **`/dashboard/applications` →
Register an application**:

| Field | Notes |
| --- | --- |
| Application name | Shown on the consent screen |
| Slug | `keccak256(slug)` is the on-chain application key. Changing it later registers a *different* application |
| Homepage URL | Linked from the consent screen |
| Description | One line, shown to the visitor |
| Logo URL | Optional, shown on the consent screen |
| Callback URLs | One or more **exact** URLs. https unless localhost. No query string or fragment |
| Allowed roles | Any of `ADMIN`, `MANAGER`, `AUDITOR`, `USER` |

Submitting it:

1. Saves the configuration and issues a **client id** and **client secret**. The
   plaintext secret is displayed once, with a warning, and never again — OwneX
   stores only its digest.
2. Prompts the admin to sign `registerApplication(orgId, appId, metadataHash)`.
3. Prompts the admin to sign one `setAppAccess(orgId, appId, role, true)` per
   chosen role.

The Applications screen then shows the integration status pipeline:

```
Draft → Registered on-chain → Callback configured → Secret generated → Active
```

**Active** requires all four preceding steps *and* at least one role the contract
actually admits. Any earlier step names what is missing.

Also available on each card: **copy integration details** (client id,
authorization URL, exchange endpoint, verification endpoint, environment variable
names), **rotate secret**, and **revoke integration**.

### Revoking

Revoking sets `status = 'revoked'`. Every new authorization request and every code
exchange is refused from the next request onwards. The application record, its
callbacks and all audit history are kept — a compromised integration has to be
stoppable without destroying the record of what it did. It can be restored later.

Revoking is not the same as withdrawing on-chain access: `setAppAccess` remains
the authority over which roles may sign in. Revocation is the platform-side kill
switch that works in one request without a transaction.

### From the command line

For local development, the same configuration can be provisioned without the UI:

```bash
cd apps/platform
npm run provision:app -- \
  --slug employee-portal \
  --name "Employee Portal" \
  --url http://localhost:3001 \
  --callback http://localhost:3001/callback \
  --roles ADMIN,MANAGER,AUDITOR,USER \
  --org 1
```

It prints the environment block, including the client secret, once. It holds no
key, so it cannot register the application on-chain or grant any role access —
those still require the admin's signatures.

---

## 4. Integrating a partner website

### Environment

```bash
OWNEX_ORIGIN=https://ownex-platform.vercel.app
OWNEX_CLIENT_ID=ownex_0123456789abcdef0123456789abcdef
OWNEX_CLIENT_SECRET=oxs_…            # SERVER ONLY
OWNEX_ORG_ID=1
OWNEX_REDIRECT_URI=https://time.acme.com/auth/ownex/callback
OWNEX_APP_SLUG=acme-time-tracking
```

> ⚠ **Never put `OWNEX_CLIENT_SECRET` in frontend JavaScript**, in a
> `NEXT_PUBLIC_`/`VITE_`/`REACT_APP_` variable, in a response body, or in a client
> component. Anything shipped to a browser is public. Anyone who reads the secret
> can redeem authorization codes as your application. If it leaks, rotate it
> immediately from the Applications screen.

### Step 1 — redirect, with a `state` you remember

`state` is your CSRF defence. Without it, an attacker can obtain a code for *their*
OwneX account and feed it to your callback, and your site will sign the victim's
browser in as the attacker.

```ts
// app/api/login/route.ts
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { session } from "@/lib/session";

export async function GET() {
  const state = randomBytes(32).toString("base64url");

  const store = await session();
  store.state = state;
  store.stateExpires = Date.now() + 5 * 60_000;
  await store.save();

  const authorize = new URL("/authorize", `${process.env.OWNEX_ORIGIN}/`);
  authorize.searchParams.set("client_id", process.env.OWNEX_CLIENT_ID!);
  authorize.searchParams.set("org_id", process.env.OWNEX_ORG_ID!);
  authorize.searchParams.set("redirect_uri", process.env.OWNEX_REDIRECT_URI!);
  authorize.searchParams.set("state", state);

  return NextResponse.redirect(authorize);
}
```

OwneX requires a `state` of at least 8 characters and refuses the request without
one.

### Step 2 — validate `state`, then exchange the code from your backend

```ts
// app/api/callback/route.ts
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { session } from "@/lib/session";

function statesMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const error = url.searchParams.get("error") ?? "";
  const origin = new URL("/", request.url).origin;
  const deny = (reason: string) =>
    NextResponse.redirect(new URL(`/denied?reason=${reason}`, origin));

  const store = await session();
  const expected = store.state;
  const expires = store.stateExpires;

  // Single use: clear it before doing anything else.
  store.state = undefined;
  store.stateExpires = undefined;
  await store.save();

  // 1. state FIRST, before the code is even looked at.
  if (!state || !expected || !expires || expires < Date.now() || !statesMatch(state, expected)) {
    return deny("INVALID_STATE");
  }
  if (error) return deny(error.toUpperCase());
  if (!code) return deny("INVALID_CODE");

  // 2. Exchange, from the server, with the secret.
  const response = await fetch(`${process.env.OWNEX_ORIGIN}/api/authorize/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.OWNEX_CLIENT_ID,
      client_secret: process.env.OWNEX_CLIENT_SECRET, // never in the browser
      code,
      redirect_uri: process.env.OWNEX_REDIRECT_URI,   // must match exactly
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return deny(body.code ?? `EXCHANGE_${response.status}`);
  }

  const claims = await response.json();

  // 3. Your own session. Store the wallet; do NOT store the role.
  store.wallet = String(claims.wallet).toLowerCase();
  store.orgId = claims.orgId;
  store.verifiedAt = claims.verifiedAt;
  await store.save();

  return NextResponse.redirect(new URL("/dashboard", origin));
}
```

Never take the wallet from a URL parameter. An address in a query string proves
nothing — addresses are public and anyone can type one. The only trustworthy
source is the exchange response.

### Step 3 — revalidate on every request

Do not cache the role. An admin revoking access, a suspended organization or an
expired membership must take effect immediately, and it only can if you ask.

```ts
// lib/ownex.ts
const auth =
  "Basic " +
  Buffer.from(`${process.env.OWNEX_CLIENT_ID}:${process.env.OWNEX_CLIENT_SECRET}`).toString("base64");

export async function verifyAccess(wallet: string) {
  const url = new URL("/api/roles/verify", `${process.env.OWNEX_ORIGIN}/`);
  url.searchParams.set("wallet", wallet);
  url.searchParams.set("orgId", process.env.OWNEX_ORG_ID!);
  url.searchParams.set("app", process.env.OWNEX_APP_SLUG!);

  try {
    const response = await fetch(url, { headers: { authorization: auth }, cache: "no-store" });
    // Fail closed: an unreachable OwneX is a denial, not an open door.
    if (!response.ok) return { allowed: false, reason: `HTTP_${response.status}` };
    const body = await response.json();
    return body.allowed === true ? body : { allowed: false, reason: body.reason };
  } catch {
    return { allowed: false, reason: "VERIFICATION_UNAVAILABLE" };
  }
}
```

Reason codes you should handle:

| Code | Meaning |
| --- | --- |
| `IDENTITY_NOT_REGISTERED` | The wallet has no OwneX identity |
| `IDENTITY_REVOKED` | The identity was revoked |
| `ORGANIZATION_SUSPENDED` | The organization is suspended |
| `ROLE_EXPIRED` | The membership behind the role lapsed |
| `NOT_A_MEMBER` | No role in that organization |
| `APP_ACCESS_NOT_GRANTED` | Valid role, but not permitted for this application |
| `APPLICATION_NOT_REGISTERED` | No `registerApplication` transaction on-chain |
| `APPLICATION_REVOKED` | An admin revoked the integration |
| `CHAIN_UNAVAILABLE` (503) | OwneX could not read the chain. **Deny.** |

`allowed: true` appears only when every condition passed.

---

## 5. API reference

### `GET /authorize`

| Parameter | Required | Notes |
| --- | --- | --- |
| `client_id` | yes | Issued at registration |
| `org_id` | yes | Must match the organization the application is registered to |
| `redirect_uri` | yes | Must exactly match a registered callback |
| `state` | yes | 8–512 characters, unguessable, generated per request |

On approval: `303` to the **registered** callback with `code` and `state`.
On refusal by the user: `error=access_denied` and `state`.
When the chain cannot be read: `error=temporarily_unavailable` and `state`.
When the client, organization or callback cannot be validated: the error is
rendered on the OwneX page rather than redirected, because there is no URL yet
that is safe to redirect to.

### `POST /api/authorize/exchange`

```json
{ "client_id": "…", "client_secret": "…", "code": "…", "redirect_uri": "…" }
```

| Status | Meaning |
| --- | --- |
| `200` | Claims, as in §2 |
| `400 CODE_REJECTED` | Code invalid, expired, or already used |
| `401 INVALID_CLIENT` | Unknown client, wrong secret, revoked application, or unregistered redirect URI — deliberately indistinguishable |
| `403` | Access was withdrawn between consent and exchange |
| `503` | Chain or store unreadable. Deny |

### `GET /api/roles/verify`

`?wallet=0x…&orgId=1&app=<slug>`

Authentication: HTTP Basic `client_id:client_secret`, or
`X-OwneX-Client-Id` / `X-OwneX-Client-Secret`.

**Development-only public mode.** Outside production an unauthenticated call is
answered, because the endpoint exposes only public chain state and a local
integration is far easier to build that way. In production it returns
`401 CLIENT_AUTH_REQUIRED`. This is decided by `NODE_ENV` alone; there is no
environment variable that can switch authentication off in production. The
response carries `authMode`, so a partner notices at once if it is relying on the
development path.

An authenticated partner may only ask about **its own** application and **its own**
organization; anything else is `403`.

---

## 6. Reference integration

`apps/employee-portal` is the worked example: an ordinary Next.js app with no
wallet library, no ABI and no private key. Read in this order:

| File | What it shows |
| --- | --- |
| `lib/config.ts` | Configuration, and why there is no default secret |
| `app/api/login/route.ts` | Generating and storing `state`, then redirecting |
| `app/api/callback/route.ts` | Validating `state`, then exchanging the code |
| `lib/ownex.ts` | Live revalidation, failing closed |
| `lib/session.ts` | Why the role is deliberately not stored |
| `app/dashboard/page.tsx` | Revalidating on every render |

---

## 7. Environment variables

### Platform (`apps/platform/.env.local`)

Unchanged, except that the old `PORTAL_CLIENT_SECRET`, `PORTAL_CALLBACK_URL` and
`PORTAL_CALLBACK_URLS` variables are **gone**. Per-application credentials and
callbacks live in Supabase, so each integration is rotated and revoked
independently and no shared secret sits in an environment file.

`APP_ORIGIN` matters more than it did: it is the origin OwneX advertises in the
integration details handed to partners, so it must be the exact public origin of
the deployment.

### Partner application

`OWNEX_ORIGIN`, `OWNEX_CLIENT_ID`, `OWNEX_CLIENT_SECRET`, `OWNEX_ORG_ID`,
`OWNEX_REDIRECT_URI`, `OWNEX_APP_SLUG` — see §4.

---

## 8. Database

`supabase/migrations/0001_generic_sso.sql`, idempotent, preserves existing rows:

- `applications` gains `client_id` (unique where not null), `client_secret_hash`,
  `client_secret_updated_at`, `allowed_roles`, `status`, `updated_at`.
- `application_callbacks` is new: one row per exact callback, `FOREIGN KEY
  (org_id, app_slug)` cascading, unique per application, with a `CHECK` that the
  URL is absolute http(s) with no query string or fragment.
- `authorization_codes` gains `client_id` and `org_id` (both `NOT NULL`),
  `issued_at`, wallet and redirect format checks, and an index on pending codes.
  Rows predating the migration are removed before the constraint is applied — a
  code with no client id must never be redeemable, and a code older than two
  minutes was already unusable.
- Row Level Security is on for the new table with no permissive policies, and
  `anon`/`authenticated` are revoked. Only the server's service-role key can read
  it.

---

## 9. Tests

`cd apps/platform && npm test` — 107 tests, no database and no chain required.

| File | Covers |
| --- | --- |
| `lib/callback-allowlist.test.ts` | Exact matching, unknown and revoked applications, HTTPS enforcement, localhost refused in production, malformed input, open-redirect prevention, `state` preserved verbatim |
| `lib/client-credentials.test.ts` | Entropy, salted digest, constant-time verification, every degenerate stored value failing closed, no fallback secret |
| `lib/authorize.test.ts` | Two-minute expiry, replay refused, concurrent exchange, wrong client, wrong redirect URI, store failure propagating instead of reading as "invalid" |
| `lib/access-decision.test.ts` | Every denial reason, revocation reported as revocation, no combination producing an approval, the claim allow-list, no private field reachable |
| `lib/sso-flow.test.ts` | The whole flow composed end to end: successful registration and authorization, cross-application code and secret reuse refused, identity revoked / access withdrawn / role expired between consent and exchange, RPC failure failing closed in every single read, CSRF `state` round trip |
| `lib/integration.test.ts` | The status pipeline, Active requiring on-chain role access, endpoint construction |
| `lib/partner-credentials.test.ts` | Basic auth parsing, half credentials refused, production requiring authentication with no override |

`npm run verify:api` exercises the live endpoints against a running platform and a
local chain: the applications list, the client-id/secret privacy boundary, uniform
`401 INVALID_CLIENT` on the exchange, `/authorize` refusing to redirect to an
unvalidated callback, and the absence of any private profile field in
`/api/roles/verify`.

`npm test` at the repository root runs the 93 contract tests, which are unchanged.
