# OwneX Vercel deployment plan

## Recommended architecture

Deploy the two Next.js applications as two Vercel projects connected to the same
Git repository. Do not deploy the repository root: it is the Hardhat contracts
workspace, not a web application.

| Vercel project | Root directory | Suggested production domain |
| --- | --- | --- |
| `ownex-platform` | `apps/platform` | `platform.ownex.com` |
| `ownex-employee-portal` | `apps/employee-portal` | `employees.ownex.com` |

The apps have their own `package-lock.json` files, so Vercel can use each
directory's native Next.js settings: Install Command `npm install` and Build
Command `npm run build`.

## Phase 1 — make the cross-app authorization production-ready

1. Replace the localhost-only callback rule in
   `apps/platform/lib/authorize.ts`. `validRedirect()` currently accepts only
   `http://localhost:3001/callback`, which will reject every deployed Employee
   Portal login.
2. Introduce a server-only configured allowlist, initially containing the
   production portal callback and the explicitly selected preview callback.
   Preserve the localhost callback only for local development.
   **Superseded:** callbacks are no longer configured by environment variable at
   all. They are registered per application in `application_callbacks` and
   matched exactly, so there is no allow-list to keep in step with a deployment.
3. Remove production fallbacks for the portal client secret and portal session
   password. **Done, and superseded:** there is no shared portal secret any
   more. Each registered application has its own client id and its own client
   secret, stored on the Platform only as a scrypt digest, rotatable and
   revocable per integration. `PORTAL_SESSION_PASSWORD` is required with no
   fallback.
4. Add an `apps/employee-portal/.env.local.example` documenting the portal's
   required variables.
5. Update the outdated README statements which say the Employee Portal is not
   present/deployable, and document the two-app deployment model.

Critical paths: `apps/platform/lib/authorize.ts`,
`apps/platform/app/api/authorize/exchange/route.ts`,
`apps/employee-portal/lib/session.ts`,
`apps/employee-portal/app/api/login/route.ts`,
`apps/employee-portal/app/api/callback/route.ts`, and `README.md`.

## Phase 2 — configure Vercel

1. Import the same Git repository twice in Vercel. Set the Root Directory for
   the Platform project to `apps/platform`; set it to `apps/employee-portal`
   for the Portal project.
2. Assign the final production domains before the production deployment. The
   SIWE domain and callback URL must be stable; changing them later invalidates
   the signed-message configuration and callback allowlist.
3. In `ownex-platform`, configure all variables required by
   `apps/platform/.env.local.example`, with Sepolia values:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
     `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `RPC_URL`, `CHAIN_ID=11155111`, and the three deployed contract addresses
   - `SESSION_PASSWORD`, `PII_ENCRYPTION_KEY`
   - `APP_DOMAIN=platform.ownex.com`,
     `APP_ORIGIN=https://platform.ownex.com`, and
     `NEXT_PUBLIC_APP_URL=https://platform.ownex.com`
   - the matching `NEXT_PUBLIC_CHAIN_*`, explorer, RPC, and contract-address
     values.
4. In `ownex-employee-portal`, configure (see
   `apps/employee-portal/.env.local.example` and
   [`docs/sign-in-with-ownex.md`](../docs/sign-in-with-ownex.md)):
   - `OWNEX_ORIGIN=https://platform.ownex.com`
   - `OWNEX_REDIRECT_URI=https://employees.ownex.com/callback` — must match,
     character for character, a callback URL registered for this application on
     the Platform's Applications screen
   - `OWNEX_CLIENT_ID` and `OWNEX_CLIENT_SECRET`, issued when an organization
     admin registers the application. The secret is shown once; it exists in the
     Portal project only, because the Platform stores only its hash. There is no
     shared value to duplicate any more, and nothing to set on the Platform side.
   - `OWNEX_ORG_ID=1`, unless a different organization is intentionally used
   - `OWNEX_APP_SLUG=employee-portal`
   - `PORTAL_SESSION_PASSWORD` (a distinct 32+ character high-entropy value; the
     Portal refuses to start a session without it)
5. Add every secret to Vercel's encrypted environment-variable store, never to
   Git. Rotate the Supabase service-role key before launch because the README
   records prior exposure.

## Phase 3 — preview and production rollout

1. Deploy a Platform preview and use `/api/health` to confirm Supabase, Sepolia
   RPC, and contracts are reachable.
2. Configure Portal preview variables to target a matching Platform preview,
   and add its exact callback URL to the Platform's preview allowlist. Do not
   mix preview code with production secrets without an explicit staging policy.
3. Test the complete authorization flow: Portal login, Platform sign-in, grant
   approval, callback, code exchange, and Portal session.
4. Deploy Platform production and confirm the production URL, metadata,
   manifest, SIWE domain, and health endpoint.
5. Apply the production Portal variables, deploy Portal production, and repeat
   the full end-to-end test using the final domains.

## Verification checklist

- Before deployment, run each app's `typecheck`, `lint`, and `build` commands.
- Test both desktop and 390px mobile views for the Platform.
- Verify an authorized user can open the Portal dashboard and assets page.
- Verify revoked, expired, and unregistered wallets are denied by the Portal.
- Verify a modified, missing, expired, or unallowlisted callback is rejected.
- Check browser bundles and Vercel logs for absence of service-role keys,
  private keys, session passwords, PII keys, and client secrets.
- Confirm no `localhost` URL remains in production responses, metadata, asset
  metadata URIs, or the on-chain application registration. If the on-chain
  Employee Portal URL is currently localhost, update/re-register it through the
  existing Sepolia administration workflow before launch.
