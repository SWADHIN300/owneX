# OwneX — Build Progress

Running log. Updated at the end of every phase. Newest phase at the top of the
"Completed" section.

**Last updated:** 2026-08-26 · after Phase 2
**Overall:** 2 of 8 phases done · 93 tests passing · nothing deployed to Sepolia yet

> Detailed write-up for each finished phase lives beside this file:
> `read/phase-1-contracts.md`, `read/phase-2-tests-and-deploy.md`, and so on.
> See `read/README.md` for the convention.

---

## Phase status

| # | Phase | State | Write-up |
|---|---|---|---|
| 1 | Smart contracts | ✅ done | `phase-1-contracts.md` |
| 2 | Tests + local deploy + demo seed | ✅ done | `phase-2-tests-and-deploy.md` |
| 3 | Backend: Supabase + SIWE auth + role API | ⬜ next | — |
| 4 | Design system + landing page | ⬜ | — |
| 5 | Platform dashboard (all pages) | ⬜ | — |
| 6 | Employee Portal (second app) | ⬜ | — |
| 7 | Sepolia deploy + polish | ⬜ | — |
| 8 | Docs + demo video + submission | ⬜ | — |

---

# Completed

## Phase 2 — Tests, local deploy, demo seed ✅

**Test suites — 93 passing**

| File | Tests | Covers |
|---|---|---|
| `test/identity.test.ts` | 24 | registration, registrars, kill switch, hash anchoring, organizations |
| `test/access.test.ts` | 34 | RBAC, self-promotion block, role expiry, permission overrides, app access |
| `test/asset.test.ts` | 35 | org-gated mint, transfer lock, revoke/restore, verification, pause |

The security-critical assertions that are now proven, not assumed:

- a plain USER calling `mintAsset` reverts with `MissingPermission`
- a holder calling `transferFrom` reverts with `TransfersLocked`
- an approved operator *and* an approve-for-all operator still cannot move a locked asset
- nobody can promote themselves — including a full ADMIN targeting their own membership
- an org cannot deny ADMIN its own governance permissions (lockout guard)
- a revoked identity loses every role, permission, and app access in the same block
- a suspended organization freezes every permission inside it
- `verifyOwnership` fails on revoked identity, revoked asset, suspended org, or lost membership
- a role with an expiry lapses automatically with no transaction

**Scripts**

- `scripts/deploy.ts` — deploys all three contracts, grants the platform admin
  wallet registrar rights, writes `deployments/<network>.json`, prints the env
  lines to copy.
- `scripts/seed-demo.ts` — builds **Northwind Industries** (org #1): five members
  across all four roles, one of them a contractor with a 30-day expiring role,
  the Employee Portal registered with per-role access, three asset certificates
  minted and assigned. Funds `0x69FD…3888` with 10 local ETH and makes it ADMIN
  so the demo can be driven from MetaMask immediately.

**Verified against a live local node:** deploy → seed → 5 members, 3 assets, your
wallet resolving as ADMIN.

## Phase 1 — Smart contracts ✅

Solidity 0.8.24, OpenZeppelin 5.4, evm target cancun. 26 files compile clean.

### `contracts/IdentityRegistry.sol` — root of trust

| Function | Who can call |
|---|---|
| `registerIdentity(hash)` | anyone, for themselves (self-sovereign) |
| `registerIdentityFor(wallet, hash)` | registrars only (admin onboarding) |
| `updateIdentityHash(hash)` | the wallet itself |
| `revokeIdentity(wallet)` | the wallet itself or a registrar — **the kill switch** |
| `reactivateIdentity(wallet)` | registrars |
| `createOrganization(hash)` | any active identity; caller becomes root admin |
| `updateOrganizationMetadata` / `setOrganizationActive` / `transferOrgRootAdmin` | root admin (platform owner can also suspend) |
| `setRegistrar(addr, bool)` | platform owner |

Views: `isActive`, `isRegistered`, `verifyIdentityHash`, `getOrganization`,
`isOrganizationActive`, `orgRootAdmin`, `organizationExists`.

### `contracts/OrgAccessManager.sol` — per-org RBAC

Roles as `bytes32`: `ROLE_ADMIN`, `ROLE_MANAGER`, `ROLE_AUDITOR`, `ROLE_USER`.
Permissions: `PERM_MANAGE_MEMBERS`, `PERM_ASSIGN_ROLES`, `PERM_MINT_ASSETS`,
`PERM_TRANSFER_ASSETS`, `PERM_VIEW_AUDIT`, `PERM_MANAGE_APPS`.

| Function | Notes |
|---|---|
| `addMember(orgId, wallet, role, expiresAt)` | `expiresAt = 0` means permanent |
| `assignRole(orgId, wallet, role, expiresAt)` | self-targeting blocked; root admin untouchable |
| `setRoleExpiry(orgId, wallet, expiresAt)` | extend or shorten time-bound access |
| `removeMember(orgId, wallet)` | swap-and-pop, enumeration stays consistent |
| `setPermission(orgId, role, perm, Override)` | ADMIN only; `Unset`/`Allowed`/`Denied` |
| `registerApplication` / `setAppAccess` / `canAccessApp` | the Web2 SSO layer |
| `effectiveRole(orgId, wallet)` | **the single authoritative lookup** |
| `hasPermission(orgId, wallet, perm)` | override → default matrix fallthrough |

`effectiveRole` returns `ROLE_NONE` when the identity is revoked, the membership
expired, or the wallet was never a member — three failure modes collapsed into
one check callers cannot get wrong. The org root admin always resolves to ADMIN,
so an organization can never be orphaned.

Default matrix (every cell overridable per org):

| Permission | Admin | Manager | Auditor | User |
|---|:--:|:--:|:--:|:--:|
| Manage members | ✓ | | | |
| Assign roles | ✓ | | | |
| Mint assets | ✓ | | | |
| Transfer assets | ✓ | ✓ | | |
| View audit | ✓ | ✓ | ✓ | |
| Manage applications | ✓ | | | |

### `contracts/AssetNFT.sol` — asset certificates

`ERC721` + `Enumerable` + `URIStorage` + `Ownable` + `Pausable`.
Name `OwneX Asset Certificate`, symbol `OWNX`.

| Function | Permission required |
|---|---|
| `mintAsset(orgId, assignedTo, assetHash, uri)` | `PERM_MINT_ASSETS` |
| `reassignAsset(tokenId, newHolder)` | `PERM_TRANSFER_ASSETS` |
| `revokeAsset(tokenId)` | `PERM_TRANSFER_ASSETS` — custody returns to root admin |
| `restoreAsset(tokenId, assignedTo)` | `PERM_TRANSFER_ASSETS` |
| `updateAssetRecord(tokenId, hash, uri)` | `PERM_MINT_ASSETS` |
| `pause` / `unpause` | platform owner |

Views: `verifyOwnership`, `verifyAssetHash`, `getAsset`, `assetsOfHolder`,
`assetsOfOrganization`, `totalMinted`.

The transfer lock lives in the `_update` override: mint and burn pass through,
everything else must be flagged as organization-controlled, which only the three
permission-gated movement functions can do.

### Events — the audit trail

```
IdentityRegistry   IdentityRegistered · IdentityHashUpdated · IdentityRevoked
                   IdentityReactivated · RegistrarUpdated · OrganizationCreated
                   OrganizationMetadataUpdated · OrganizationStatusChanged
                   OrgRootAdminTransferred

OrgAccessManager   MemberAdded · MemberRemoved · RoleAssigned · RoleExpiryUpdated
                   PermissionUpdated · ApplicationRegistered · AppAccessChanged

AssetNFT           AssetMinted · AssetAssigned · AssetRevoked · AssetRestored
                   AssetMetadataUpdated  (+ standard ERC-721 Transfer/Approval)
```

Phase 5's Audit Trail page reads these via `queryFilter`, cached in Supabase.

---

# Remaining

## Phase 3 — Backend: Supabase + SIWE + role API ⬜ NEXT

```
⬜ Create Supabase project, capture URL + anon key + service role key
⬜ Tables: profiles · organizations · assets · audit_cache · nonces
⬜ Enable Row Level Security on every table
⬜ Scaffold apps/platform (Next.js App Router + TS + Tailwind)
⬜ lib/: supabase.ts (server-only) · contracts.ts (ethers provider) · siwe.ts
        session.ts (iron-session) · crypto.ts (PII encryption)
⬜ POST /api/auth/nonce        single-use nonce, 5-min TTL
⬜ POST /api/auth/verify       recover signer, check domain+chainId+nonce+expiry,
                              read on-chain role, set httpOnly cookie
⬜ GET  /api/identity/me       wallet from cookie → role + profile
⬜ GET  /api/roles/verify      the endpoint the Employee Portal calls
⬜ GET  /api/assets            on-chain owner joined with Supabase data
⬜ POST /api/assets            admin only, role re-read from chain
⬜ GET  /api/metadata/[id]     serves the ERC-721 metadata JSON
⬜ GET  /api/audit             paged from audit_cache
⬜ Event indexer: queryFilter → audit_cache
```

Two rules to hold to, from the locked spec:

1. **Trust boundary** — never trust a wallet address from a request body. Only a
   signature-recovered address or the httpOnly session cookie.
2. **Role freshness** — for sensitive actions (mint, assign, revoke) re-read the
   role from the contract at request time, not from the cached cookie. This is
   what makes live revocation land instantly in the demo.

## Phase 4 — Design system + landing ⬜

```
⬜ Six gradient CSS variables (Dawn, Aurora, Deep, Canopy, Sand, Dusk)
⬜ Tailwind config: colors, gradients, radii, shadows, sans + mono fonts
⬜ Components: Button · Input · Select · GlassCard · Badge · RoleChip
              VerificationBadge · Modal · Toast · Skeleton · NetworkChip
              WalletPill · Identicon (deterministic from address)
⬜ Light + dark tokens, 4.5:1 contrast verified
⬜ Landing page with the node-and-edge mesh hero
⬜ On-chain vs off-chain explainer diagram
```

## Phase 5 — Platform dashboard ⬜

```
⬜ Wallet connect modal + 4-stage signing rail
⬜ Onboarding (Individual vs Organization fork)
⬜ App shell (sidebar, topbar, org switcher, network chip)
⬜ Admin overview (stat cards + org graph + activity feed)
⬜ My Identity
⬜ Members (table, invite modal, role actions)
⬜ Roles & Permissions (cards + permission matrix + confirmations)
⬜ Applications (connected apps + integration rail)
⬜ Asset Vault (grid/table, certificate cards, filters)
⬜ Mint NFT wizard (off-chain vs on-chain split columns)
⬜ Asset detail (provenance + verify ownership animation)
⬜ Audit Trail (blockchain timeline from events)
⬜ User dashboard (simple, no admin controls, no jargon)
⬜ Every required state: loading, empty, wrong network, denied, revoked, RPC fail
```

## Phase 6 — Employee Portal ⬜

```
⬜ Scaffold apps/employee-portal — ZERO ethers.js, ZERO contract code
⬜ "Login with OwneX" → redirect → sign → callback
⬜ Calls /api/roles/verify → creates its own session cookie
⬜ Role-gated pages; USER sees assigned assets, no mint button
```

This app containing no blockchain code is the demo point. It is what turns the
project from "an NFT dashboard" into "a decentralized identity provider".

## Phase 7 — Sepolia + polish ⬜

```
⬜ Throwaway deployer wallet + faucet test ETH (free, no real ETH ever)
⬜ Deploy 3 contracts to Sepolia, verify on Etherscan
⬜ Point both apps at Sepolia addresses
⬜ Run the full demo path with 4 separate MetaMask accounts
⬜ Record every transaction hash
⬜ Animation pass + prefers-reduced-motion
⬜ Optional: swap metadata to IPFS/Pinata (one-line tokenURI change)
```

## Phase 8 — Submission ⬜

```
⬜ Architecture + data-flow diagrams
⬜ Deployed addresses, test output
⬜ Demo video following the rehearsed path
⬜ Limitations section (already drafted in README)
⬜ Deploy both apps to Vercel
```

---

# How to run what exists today

```bash
npm install
npm run compile
npm test                 # 93 passing

npx hardhat node         # terminal 1
npm run deploy:local     # terminal 2
npm run seed:local
```

MetaMask local network: `http://127.0.0.1:8545`, chain ID `31337`.

---

# Decisions log

Recorded so they don't get relitigated, and so they can be defended on demo day.

| Decision | Why |
|---|---|
| Roles are mappings, not NFTs | a role NFT could be sold, letting anyone buy Manager rights |
| Asset transfers locked to org control | a company laptop is not a collectible; holder custody without alienability |
| Tri-state permission overrides | zero-config for a new org, full customisation without redeploy |
| Governance lockout guard | an org physically cannot strip ADMIN of its own governance |
| Time-bound roles | contractor access lapses on a deadline, not on someone's memory |
| Only hashes on-chain | tamper-evidence without publishing personal data |
| Backend inside Next.js route handlers | one repo, one deploy, shared types, no CORS |
| Supabase for DB + storage | Postgres, file storage, and RLS without standing up infra |
| Metadata from API first, IPFS later | `tokenURI` is just a string; swapping it never touches the contract |
| Sepolia, never mainnet | real ETH is never needed for this project |
| `typescript` pinned to 5.7.3 | TS 7 breaks ts-node on Node 25 — **do not unpin** |

---

# Open items needing input

```
⬜ Supabase project URL + anon key + service role key   (blocks Phase 3 wiring)
⬜ Sepolia RPC URL + throwaway deployer private key     (blocks Phase 7)
⬜ Real asset photos for the demo, or use generated certificate cards
```
