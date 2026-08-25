# OwneX

**Own it. Prove it.** — verifiable identity, access, and ownership.

A blockchain platform for decentralized identity, organization-wide role-based
access control, and NFT-backed asset ownership, with a tamper-evident audit
trail. Built for Smart India Hackathon.

```
93 contract tests passing  ·  84 API assertions passing  ·  3 of 8 phases done
```

---

## What it does

An organization onboards people as wallet-bound identities, assigns them roles,
and issues assets as NFT certificates. A separate Web2 application can then log
those people in and read their roles without containing a single line of
blockchain code.

Four things make it more than a CRUD app with a wallet button:

**Roles expire on their own.** A contractor's access lapses at a block deadline
instead of depending on somebody remembering to revoke it.

**Company assets cannot be sold.** An employee genuinely holds their laptop's
NFT and can prove custody to anyone — but `transferFrom` reverts. A plain ERC-721
gives you tradeable-or-nothing; this gives custody without alienability.

**Revocation cascades in one transaction.** Revoking an identity drops its role
to `NONE` across every organization, every permission, every connected
application, and ownership verification, in the same block.

**Nothing personal is on-chain.** Only `keccak256` anchors. Re-hash the encrypted
off-chain record and compare: match proves it is unmodified, mismatch proves it
was edited. Tamper-evidence without publishing anything private.

---

## Status

| # | Phase | State | Write-up |
|---|---|---|---|
| 1 | Smart contracts | ✅ done | [`read/phase-1-contracts.md`](read/phase-1-contracts.md) |
| 2 | Tests, local deploy, demo seed | ✅ done | [`read/phase-2-tests-and-deploy.md`](read/phase-2-tests-and-deploy.md) |
| 3 | Backend: Supabase, SIWE auth, role API | ✅ done | [`read/phase-3-backend.md`](read/phase-3-backend.md) |
| 4 | Design system + landing page | ⬜ next | — |
| 5 | Platform dashboard | ⬜ | — |
| 6 | Employee Portal (proves cross-app SSO) | ⬜ | — |
| 7 | Sepolia deploy + polish | ⬜ | — |
| 8 | Docs, demo video, submission | ⬜ | — |

Live status and everything remaining: [`read/PROGRESS.md`](read/PROGRESS.md)

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│  Platform app   │     │ Employee Portal  │  ← contains NO contract code;
│  Next.js + UI   │     │ Next.js          │    gets identity and role from
└────────┬────────┘     └────────┬─────────┘    the role API
         │                       │
         └───────────┬───────────┘
                     │  SIWE signature → httpOnly session
         ┌───────────▼─────────────┐
         │ Next.js Route Handlers  │  nonce · verify · identity/me · roles/verify
         └───────────┬─────────────┘
                     │
     ┌───────────────┴────────────────┐
     │                                │
┌────▼──────────────┐      ┌──────────▼─────────┐
│ Supabase          │      │ Ethereum (Sepolia) │
│ profiles, assets  │      │ 3 contracts        │
│ audit cache       │      │ events = the audit │
│ encrypted PII     │      │ trail              │
└───────────────────┘      └────────────────────┘
```

### The three contracts

| Contract | Responsibility |
|---|---|
| `IdentityRegistry` | Wallet-bound identities, organizations, the revocation kill switch. Root of trust. |
| `OrgAccessManager` | Per-org RBAC: Admin / Manager / Auditor / User, permission matrix, time-bound roles, application access. |
| `AssetNFT` | ERC-721 asset certificates. Org-gated minting, non-tradeable holder custody, revocation, hash verification. |

### On-chain vs off-chain

```
ON-CHAIN (source of truth)          OFF-CHAIN (Supabase, encrypted)
──────────────────────────          ────────────────────────────────
identity hash                       name, email, phone
organization + root admin           org profile, logo
role + expiry                       department, job title
NFT token id + holder               asset name, description, image
asset hash                          serial numbers, invoices
every audit event                   cached events for fast paging
metadata URI                        the metadata JSON itself
```

If the two ever disagree, the chain wins. Supabase is a cache and a private
store, never the authority on ownership or roles.

---

## Tech stack

```
Contracts     Solidity 0.8.24 · OpenZeppelin 5 · Hardhat 2 · TypeScript
Chain         Hardhat localnet (31337) → Sepolia (11155111)
Frontend      Next.js 16 (App Router) · TypeScript · Tailwind 4
Backend       Next.js Route Handlers
Auth          SIWE (EIP-4361) + iron-session, httpOnly encrypted cookie
Web3          ethers v6
Database      Supabase Postgres, RLS on every table
Storage       Supabase Storage (asset images)
Metadata      served from the API → IPFS later (tokenURI is just a string)
Cost          ₹0 — localnet and Sepolia faucet ETH only, never real ETH
```

---

## Setup

```bash
git clone https://github.com/SWADHIN300/owneX.git
cd ownex
npm install
npm run compile
npm test                 # 93 passing
```

### Full local stack

```bash
# terminal 1 — leave running
npx hardhat node

# terminal 2
npm run deploy:local
npm run seed:local

cd apps/platform
npm install
cp .env.local.example .env.local     # fill in Supabase keys
npm run seed:offchain                # seeds Supabase + creates storage bucket
npm run dev                          # http://localhost:3000
```

Apply `supabase/schema.sql` in the Supabase SQL editor once, before the first
`seed:offchain`.

Verify everything works:

```bash
node scripts/verify-api.mjs          # 84 assertions
```

MetaMask local network:

```
Network name  Hardhat Local
RPC URL       http://127.0.0.1:8545
Chain ID      31337
Currency      ETH
```

### Secrets

```bash
# SESSION_PASSWORD — 32+ chars
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# PII_ENCRYPTION_KEY — exactly 64 hex chars (AES-256)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`PII_ENCRYPTION_KEY` cannot be changed once data exists — it would make every
encrypted row unreadable.

### Sepolia (Phase 7)

Sepolia ETH is free faucet money with no real value. **No real ETH is needed at
any point in this project.**

```bash
# .env
SEPOLIA_RPC_URL=...
DEPLOYER_PRIVATE_KEY=...     # throwaway wallet, faucet ETH only

npm run deploy:sepolia
```

---

## API

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/nonce` | POST | public | issue a single-use signing challenge |
| `/api/auth/verify` | POST | public | verify signature, consume nonce, set session |
| `/api/auth/logout` | POST | session | destroy session |
| `/api/identity/me` | GET | session | identity, memberships, permissions, held assets |
| `/api/roles/verify` | GET | public | **integration endpoint** partner apps call |
| `/api/profile` | GET / PUT | session | own profile; PUT returns the hash to anchor |
| `/api/assets` | GET | member | list org assets, chain joined with database |
| `/api/assets` | POST | `MINT_ASSETS` | draft an asset, return `assetHash` + `metadataUri` |
| `/api/assets/[id]/confirm` | POST | `MINT_ASSETS` | bind draft to token, verified against chain |
| `/api/metadata/[ref]` | GET | public | ERC-721 metadata JSON |
| `/api/audit` | GET | `VIEW_AUDIT` | paged audit history with explorer links |
| `/api/audit/sync` | POST | session | run the event indexer |
| `/api/health` | GET | public | config, chain, and database reachability |

### How a Web2 app integrates

```
GET /api/roles/verify?wallet=0x…&orgId=1&app=employee-portal

{ "allowed": true, "role": "MANAGER", "reason": null,
  "identityActive": true, "organizationActive": true,
  "membership": { "expiresAt": null, "expired": false },
  "permissions": { "TRANSFER_ASSETS": true, "VIEW_AUDIT": true, … },
  "appAccess": { "slug": "employee-portal", "allowed": true } }
```

Every value is read live from the contracts, so a revoked identity or an expired
role is reflected instantly. The calling application manages its own session; this
endpoint only answers the authorization question.

---

## Default permission matrix

| Permission | Admin | Manager | Auditor | User |
|---|:--:|:--:|:--:|:--:|
| Manage members | ✓ | | | |
| Assign roles | ✓ | | | |
| Mint assets | ✓ | | | |
| Transfer assets | ✓ | ✓ | | |
| View audit | ✓ | ✓ | ✓ | |
| Manage applications | ✓ | | | |

Any cell is overridable per organization via `setPermission`, with a guard that
prevents an org from stripping ADMIN of its own governance and locking itself out.

---

## Design decisions worth defending

**Roles are storage mappings, not NFTs.** A role NFT is transferable, which would
let someone acquire Manager rights by buying a token. Membership is bound to the
wallet and cannot be moved.

**Asset certificates are not freely tradeable.** Holder-initiated transfers revert
with `TransfersLocked`. Movement happens only through `reassignAsset` /
`revokeAsset`, both permission-gated. The employee still holds the token and can
prove custody — they simply cannot alienate it.

**Permissions are tri-state over a default matrix.** `Unset` / `Allowed` /
`Denied` means a brand-new organization works with zero configuration
transactions, yet any org can reshape any role without a redeployment.

**The session stores the wallet and nothing else — no role.** Caching a role in
the cookie would delay revocation until expiry. Roles are re-read from the
contract on every request that depends on one. This single decision is what makes
instant revocation real.

**The server holds no private key and sends no transactions.** `POST /api/assets`
prepares `assetHash` and `metadataUri`; the user signs `mintAsset` themselves. The
backend physically cannot mint, assign, or revoke anything.

**Supabase has RLS on every table and zero permissive policies.** Only the
server-side service role key can read or write. Two authorization systems would
eventually disagree; the chain is the only one that decides.

**SIWE is implemented directly rather than via a library.** Six checks close six
attacks: server-generated nonce, single use, five-minute expiry, domain binding,
chain-ID binding, address match. The nonce is consumed with a conditional update
so a captured signature cannot be replayed even under concurrency.

**Canonical JSON before hashing.** `{a:1,b:2}` and `{b:2,a:1}` are the same record
but hash differently, which would produce phantom tamper alerts.

---

## Tests

```
Contracts — npm test
  93 passing
  IdentityRegistry   24  registration, registrars, kill switch, hashes, orgs
  OrgAccessManager   34  RBAC, self-promotion block, expiry, overrides, apps
  AssetNFT           35  org-gated mint, transfer lock, revocation, pause

API — node apps/platform/scripts/verify-api.mjs
  84 passed, 0 failed
  real SIWE signatures, live chain, live Supabase
```

The assertions that matter:

```
a plain USER calling mintAsset reverts with MissingPermission
a holder calling transferFrom reverts with TransfersLocked
an approved operator still cannot move a locked asset
nobody can promote themselves, including a full admin
an org cannot deny ADMIN its own governance permissions
a revoked identity loses every role and permission in the same block
a role with an expiry lapses automatically, no transaction needed
verifyOwnership fails on revoked identity, revoked asset, suspended org
the same asset endpoint masks the serial number for a plain USER
the event indexer is idempotent — 26 events, re-synced, still 26 rows
public metadata leaks no serial number and no email
```

---

## The demo path

```
Admin creates org → registers Bob (USER) → registers Carol (MANAGER)
→ mints "Company Laptop 001" → assigns to Bob
→ Bob logs into the Employee Portal: sees the laptop, no mint button
→ Bob calls mintAsset() directly in the console → contract REVERTS      ← proof 1
→ Admin revokes Bob's identity → portal access denied on next check     ← proof 2
→ Auditor opens the Audit Trail → every event verified on Etherscan
```

The revert and the revocation are the two moments that prove the security model.
Everything else is presentation.

---

## Repository layout

```
ownex/
├── contracts/          IdentityRegistry · OrgAccessManager · AssetNFT
├── test/               93 tests across three suites
├── scripts/            deploy · seed-demo · export-abi
├── supabase/           schema.sql — 7 tables, RLS everywhere
├── apps/
│   └── platform/       Next.js app: 13 API routes, 10 lib modules
│       ├── lib/        env · crypto · hash · supabase · chain
│       │               session · siwe · authz · http · indexer
│       └── scripts/    seed-offchain.mjs · verify-api.mjs
├── read/               per-phase build documentation
└── deployments/        deployed addresses per network
```

---

## Known limitations

Stated plainly, because they are design realities rather than bugs.

- **Key loss.** Losing a wallet means losing access. Mitigated only by registrar
  reactivation and root-admin transfer. Production needs social recovery or key
  rotation.
- **An NFT is not legal title.** The chain proves a wallet holds a token. It does
  not prove a person legally owns a physical laptop. That needs an organizational
  policy layer.
- **Public chain, public metadata.** Roles and asset counts are visible on-chain.
  Personal data is deliberately kept off-chain and encrypted.
- **Admin concentration.** A single org admin is a central point of failure.
  Production should use a multisig as root admin.
- **No rate limiting** on the public auth and role endpoints yet.
- **`/api/roles/verify` is unauthenticated by design.** Production would issue a
  revocable API key per integrated application.
- **The indexer runs on demand.** Production wants a cron job or a worker.
- **Not audited.** This is a hackathon proof of concept.

---

## Licence

MIT
