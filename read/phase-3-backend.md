# Phase 3 — Backend: Supabase, SIWE auth, role API

**Finished:** 2026-08-26
**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind 4 · ethers v6 · iron-session 8 · Supabase JS 2 · zod
**Result:** 11 route handlers building clean · chain layer and role API verified live against a seeded local chain

---

## 1. What was built

### The app

`apps/platform` — a Next.js app holding both the frontend (Phases 4–5) and the
backend. One repo, one deploy, shared types, no CORS.

### Libraries

| File | Responsibility |
|---|---|
| `lib/env.ts` | zod-validated environment; fails loudly with a readable list of what is missing |
| `lib/crypto.ts` | AES-256-GCM for PII, plus masking helpers for partial display |
| `lib/hash.ts` | Canonical record hashing — the off-chain ↔ on-chain anchor |
| `lib/supabase.ts` | Server-only client using the service role key |
| `lib/chain/index.ts` | Read-only contract access, role/permission constants, all chain reads |
| `lib/session.ts` | iron-session encrypted httpOnly cookie |
| `lib/siwe.ts` | EIP-4361 message building, nonce lifecycle, signature verification |
| `lib/authz.ts` | `requireCaller` / `requireActiveIdentity` / `requireMember` / `requirePermission` |
| `lib/http.ts` | `ApiError`, consistent JSON errors, handler wrapper |
| `lib/indexer.ts` | Contract events → `audit_cache`, idempotent and resumable |

### Route handlers

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/nonce` | POST | public | issue a single-use signing challenge |
| `/api/auth/verify` | POST | public | verify signature, consume nonce, set session |
| `/api/auth/logout` | POST | session | destroy session |
| `/api/identity/me` | GET | session | identity + memberships + permissions + held assets |
| `/api/roles/verify` | GET | public | **the integration endpoint** partner apps call |
| `/api/profile` | GET / PUT | session | own profile; PUT returns the hash to anchor on-chain |
| `/api/assets` | GET | member | list org assets, chain joined with database |
| `/api/assets` | POST | `MINT_ASSETS` | draft an asset, return `assetHash` + `metadataUri` |
| `/api/assets/[id]/confirm` | POST | `MINT_ASSETS` | bind a draft to a token, verified against the chain |
| `/api/metadata/[ref]` | GET | public | ERC-721 metadata JSON |
| `/api/audit` | GET | `VIEW_AUDIT` | paged audit history with explorer links |
| `/api/audit/sync` | POST | session | run the event indexer |
| `/api/health` | GET | public | config + chain + database reachability |

### Database

`supabase/schema.sql` — seven tables (`profiles`, `organizations`, `assets`,
`applications`, `audit_cache`, `indexer_state`, `nonces`), indexes, `updated_at`
triggers, and a nonce purge function.

RLS is enabled on every table with **no permissive policies**, and default grants
to `anon` / `authenticated` are revoked. Only the service role key — server side
— can read or write.

### Tooling

`scripts/export-abi.ts` + `npm run export:abi` copies ABIs from Hardhat
artifacts into `apps/platform/lib/chain/abis/`, so the app can never drift from
the deployed interface.

---

## 2. How it was verified

Ran a local chain, deployed, seeded, then started the dev server.

**Build**

```
✓ Compiled successfully in 16.0s
✓ Finished TypeScript
14 routes, 11 of them API handlers
```

**Health — chain and contracts reachable through the app**

```json
{ "configured": true, "missing": [],
  "chain":     { "reachable": true, "blockNumber": 23, "chainId": 31337 },
  "contracts": { "reachable": true, "organizationCount": 1 },
  "database":  { "reachable": false, "error": "fetch failed" } }
```

Database false is expected — Supabase credentials are still placeholders.

**Role API against live chain state, four wallets**

```
your wallet (ADMIN)  role=ADMIN    allowed=True   app=True   perms=[MANAGE_MEMBERS,ASSIGN_ROLES,MINT_ASSETS,TRANSFER_ASSETS,VIEW_AUDIT,MANAGE_APPS]
manager              role=MANAGER  allowed=True   app=True   perms=[TRANSFER_ASSETS,VIEW_AUDIT]
employee (USER)      role=USER     allowed=True   app=True   perms=[]
stranger             role=NONE     allowed=False  app=False  reason=IDENTITY_NOT_REGISTERED
```

The permission sets match the contract's default matrix exactly — the API is
reporting real on-chain state, not a hardcoded table.

**Revocation cascade through HTTP — demo proof moment #2**

```
BEFORE    role=USER  allowed=True   app=True   reason=-
  → revokeIdentity(employee) on-chain
AFTER     role=NONE  allowed=False  app=False  reason=IDENTITY_REVOKED
  → reactivateIdentity(employee)
RESTORED  role=USER  allowed=True   app=True   reason=-
```

No cookie expiry, no cache flush, no restart. This is the payoff of reading the
role from the chain per request instead of trusting the session.

**Trust boundary**

```
GET  /api/identity/me      401 UNAUTHORIZED
GET  /api/assets?orgId=1    401 UNAUTHORIZED
GET  /api/audit?orgId=1     401 UNAUTHORIZED
GET  /api/profile           401 UNAUTHORIZED
POST /api/assets            401 UNAUTHORIZED
POST /api/auth/nonce (bad)  400 VALIDATION_FAILED
GET  /api/roles/verify ()   400 BAD_REQUEST
```

Every protected endpoint refuses an unauthenticated caller. There is no code
path that reads a wallet address from a request body.

### Full end-to-end verification — 84 assertions, 0 failures

Supabase live, schema applied, seeded on both sides. `scripts/verify-api.mjs`
performs real SIWE logins with real signatures and exercises every route:

```
health              configured, chain reachable, contracts reachable, database reachable
trust boundary      5 protected routes return 401 unauthenticated
SIWE                wrong signer rejected · tampered message rejected
                    valid signature accepted · nonce replay rejected
admin session       ADMIN role, root admin flagged, DID derived,
                    identity record intact, profile joined from Supabase
assets              3 listed, chain joined with database, record intact,
                    admin sees full serial NW-LAP-4471
mint draft          assetHash + metadataUri returned; confirm refuses a
                    non-existent token and refuses a hash mismatch
metadata            ERC-721 JSON valid, live holder from chain,
                    no serial leaked, no email leaked
audit               26 events indexed, all expected event types present,
                    tx hashes present, roles decoded, re-sync idempotent
                    (26 vs 26 — no duplicates)
least privilege     USER: no MINT/ASSIGN/VIEW_AUDIT, holds assets [1,2],
                    403 on mint, 403 on audit, serial masked to •••••••4471
manager             TRANSFER_ASSETS + VIEW_AUDIT, no MINT by default
roles/verify        ADMIN/MANAGER/USER all resolved with no session,
                    stranger denied IDENTITY_NOT_REGISTERED, no email exposed
logout              session works, logout 200, then 401
```

The two results worth pointing at in a demo: **`serial number masked for a plain
user  •••••••4471`** — the same endpoint returns different data depending on an
on-chain role. And **`no duplicate rows created  26 vs 26`** — the indexer is
genuinely idempotent, so the audit cache can be rebuilt from the chain at will.

### Hash alignment

The chain seeder and the app compute identical anchors, checked against a fresh
chain:

```
identity  Arjun Mehta      match: true
asset #1  Company Laptop   match: true
asset #2  ISO 9001 cert    match: true
tamper check (wrong serial): false
```

Change a serial number off-chain and the hash stops matching. That is
tamper-evidence working, with nothing private on-chain.

---

## 3. Decisions made

**SIWE implemented directly rather than via the `siwe` package.** The library's
current major version brings its own crypto stack, which risked a mismatch with
ethers v6. Building the EIP-4361 message and verifying with `verifyMessage` is
about forty lines, removes a dependency, and means the exact message format is
under our control. Six checks close six specific attacks: server-generated
nonce, single use, five-minute expiry, domain binding, chain ID binding, address
match.

**The nonce is consumed with a conditional update.** `update … where used_at is
null` returning zero rows means another request won the race, so a captured
signature cannot be replayed even under concurrency.

**The server re-derives the expected message and compares.** A client cannot
smuggle altered fields past verification by signing a different message that
happens to contain a valid nonce.

**The session stores the wallet and nothing else — no role.** Caching a role in
the cookie would delay revocation until expiry. This single decision is what
makes the live-revocation demo work.

**The server holds no private key and sends no transactions.** Every state
change is signed by the user's own wallet. `POST /api/assets` prepares
`assetHash` and `metadataUri`; the user calls `mintAsset` themselves. The backend
cannot mint, assign, or revoke anything on its own.

**Mint is draft → sign → confirm.** The metadata URI must exist before minting,
but the token ID does not exist until after. Rows are therefore created with a
UUID and `token_id` null, and the metadata route accepts either form. On confirm,
the server reads the token from the chain and refuses to bind unless the on-chain
asset hash matches the draft — so nobody can attach their record to someone
else's token.

**Every RLS table, zero policies.** Supabase is a data store, not a permission
system. Two authorization systems would eventually disagree; the chain is the
only one that decides.

**Display-name lookups are non-fatal.** `/api/roles/verify` returns the correct
authorization answer even if Supabase is unreachable, because the answer comes
from the chain. A cosmetic lookup must never turn a valid `allowed` into a 500.

**Canonical JSON before hashing.** `{a:1,b:2}` and `{b:2,a:1}` are the same
record but hash differently, which would produce phantom tamper alerts. Keys are
sorted recursively and `undefined` dropped.

**Metadata splits immutable from mutable.** Name, type, and image are frozen in
the JSON; holder and active status are read live from the chain. That is how an
asset can be reassigned without the metadata going stale — and why the URI can
later be pointed at IPFS without breaking anything.

---

## 4. What this unblocks

Phases 4 and 5. The dashboard can now authenticate a wallet, read identity and
role, list assets, drive the mint flow, and page the audit trail. Phase 6's
Employee Portal has exactly one dependency — `/api/roles/verify` — and it is
built and verified.

---

## 5. Known gaps

- The indexer runs on demand only. Production wants a cron job or a small
  always-on worker listening for events.
- No rate limiting on `/api/auth/nonce` or `/api/roles/verify`. Fine for a demo,
  needed before real use.
- `/api/roles/verify` is unauthenticated by design. Production would issue an API
  key per integrated application so usage is attributable and revocable.
- No CSRF token on state-changing routes. `sameSite: lax` plus JSON-only bodies
  covers the realistic cases for a PoC.
- No automated tests for the route handlers in CI. `scripts/verify-api.mjs`
  covers 84 assertions but must be run manually against a live stack.
- Expired nonces accumulate until `purge_expired_nonces()` is called. Harmless,
  but should be scheduled.
- Asset images are not uploaded yet — the `asset-images` bucket exists and is
  public, but the upload path is Phase 5 UI work.
- Supabase secret key has been shared in a chat log during setup and should be
  rotated before the demo.

### Resolved during this phase

- ~~Supabase credentials are placeholders~~ — live project connected, schema
  applied, 7 tables verified.
- ~~Schema not applied~~ — applied and confirmed.
- ~~No storage bucket~~ — `asset-images` created (public, 5 MB, image MIME types
  only).
- ~~Database writes unverified~~ — nonces, profiles, asset drafts, and the audit
  cache all verified working.
