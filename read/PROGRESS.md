# OwneX — Build Progress

Running log. Updated at the end of every phase. Newest phase at the top of the
"Completed" section.

**Last updated:** 2026-08-28 · after Phase 5 write paths, applications, onboarding
**Overall:** 6 of 8 phases done · 93 contract tests + 130 API assertions + 60 contrast checks passing · no blockers

> Detailed write-up for each finished phase lives beside this file:
> `read/phase-1-contracts.md`, `read/phase-2-tests-and-deploy.md`, and so on.
> See `read/README.md` for the convention.

---

## Phase status

| # | Phase | State | Write-up |
|---|---|---|---|
| 1 | Smart contracts | ✅ done | `phase-1-contracts.md` |
| 2 | Tests + local deploy + demo seed | ✅ done | `phase-2-tests-and-deploy.md` |
| 3 | Backend: Supabase + SIWE auth + role API | ✅ done | `phase-3-backend.md` |
| 4 | Design system + landing page | ✅ done | `phase-4-frontend.md` |
| 5 | Platform dashboard (all pages) | ✅ done | — |
| 6 | Employee Portal (second app) | ✅ done | `phase-6-employee-portal.md` |
| 7 | Sepolia deploy + polish | ⬜ | — |
| 8 | Docs + demo video + submission | ⬜ | — |

Supabase is connected and verified. Rotate the secret key before the demo — it was shared in a chat log during setup.

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

## Phase 3 — Backend ✅ DONE

Built and fully verified. Detail in `phase-3-backend.md`.

```
✅ Next.js 16 app at apps/platform (App Router, TS, Tailwind 4)
✅ Supabase project live; schema applied; 7 tables with RLS on, zero policies
✅ asset-images storage bucket created (public, 5MB, images only)
✅ lib/: env · crypto · hash · supabase · chain · session · siwe · authz · http · indexer
✅ 13 API route handlers
✅ scripts/export-abi.ts keeps app ABIs in sync with artifacts
✅ scripts/seed-offchain.mjs seeds the off-chain half + storage bucket
✅ scripts/verify-api.mjs — 86 assertions, 0 failures, real SIWE signatures
✅ Canonical hashing aligned across chain seeder and app (tamper check verified)
✅ Revocation cascade verified through HTTP
✅ Least privilege verified: USER gets 403 on mint and audit, serial masked
```
## Phase 4 — Design system + landing ✅ DONE

Built and verified. Detail in `phase-4-frontend.md`.

```
✅ Token layer in app/globals.css: light primary, dark opt-in, semantic names
✅ Brand #003C38 on white; lifts to #14A091 in dark so it stays legible
✅ Six named gradients (Dawn, Aurora, Deep, Canopy, Sand, Dusk) as utilities
✅ Radii, three shadow depths, brand glow, Geist Sans + Geist Mono wired
✅ 13 components: Button · Input · Select · GlassCard · Badge · RoleChip
                 VerificationBadge · Modal · Toast · Skeleton · NetworkChip
                 WalletPill · Identicon (deterministic, FNV-1a + xorshift32)
✅ 44 WCAG contrast checks passing in both themes (npm run check:contrast)
✅ Landing page with the node-and-edge mesh hero
✅ On-chain vs off-chain explainer with a live integrity check
✅ /design renders every component and state, both themes
✅ Reduced motion respected in every animated component and globally in CSS
✅ Modal: focus trap, focus restore, Escape, scroll lock, aria-modal
✅ lint, typecheck and production build clean; no console errors at 1440/834/390
```

Not wired yet: "Connect wallet" is presentational, and the network chip is
hard-coded to 31337 until a provider is connected. Both land in Phase 5.

## Phase 5 — Platform dashboard ✅

Done and verified against a live chain:

```
✅ Wallet connect + 4-stage signing rail (EIP-6963 discovery, real SIWE)
✅ App shell (sidebar, mobile nav strip, topbar, network chip)
✅ Admin overview, adapts to a plain user's role on the same route
✅ My Identity
✅ Onboarding — Individual vs Organisation fork, both wired to real transactions
✅ Members — roster, add/change-role/remove, all wired to real transactions
✅ Roles & Permissions — tri-state matrix, override writes wired
✅ Applications — connected apps, per-role access toggles wired
✅ Asset Vault — certificate grid, table alternative, filters
✅ Mint wizard — off-chain vs on-chain split columns, wired end to end
✅ Asset detail — provenance, integrity check, transfer lock explained
✅ Audit Trail — filters, cursor paging, tx hash + block, chain re-sync
✅ Every required state: loading, empty, denied, wrong network, revoked, RPC fail
```

Phase 5 is functionally complete. Nothing from the original scope remains
unbuilt: Members, Roles, Applications, the mint wizard and onboarding are all
built and wired to real transactions, and the overview adapts to the caller's
role instead of a separate user dashboard.

**Backend surface — five endpoints**, all following the patterns in
`app/api/assets/route.ts` (`handler`, `requireMember`/`requirePermission`,
`okNoStore`, zod):

| Route | Purpose |
|---|---|
| `GET /api/members?orgId=` | roster with role, expiry, identity state, asset count |
| `GET /api/roles/matrix?orgId=` | 24 cells: contract default, org override, effective |
| `GET /api/applications?orgId=` | connected apps with on-chain registration + per-role access |
| `POST /api/applications` | saves display record, returns `registerApplication` args |
| `POST /api/organizations` + `/confirm` | prepares and binds a new org, same pattern as asset mint/confirm |

Plus two chain helpers in `lib/chain/index.ts`: `readOrgMembers` and
`readPermissionMatrix`.

`readOrgMembers` unions the root admin into the contract's `getMembers` list.
The root admin becomes admin through `createOrganization`, which never touches
`_memberList`, so a roster built from the enumeration alone omits the one member
who can never be removed. The seeded org therefore shows **six** members, not
five.

**Write paths are wired**, not merely designed. A shared four-stage rail
(`components/console/tx/use-transaction.ts`) — prepare, sign, mine, record —
backs every write in the console: mint, add/change-role/remove member, set
permission override, register/toggle an application, and both onboarding forks.
`lib/contracts.ts` is a client-safe ABI layer with human-readable fragments
instead of the server's full JSON, and because it includes the custom error
fragments, ethers decodes reverts by name — `lib/tx-errors.ts` turns
`CannotTargetSelf` into "nobody promotes themselves, including a full admin"
rather than "execution reverted".

Proven against the live chain, not just rendered: a real `mintAsset` (tokens
#4–#6, real tx hashes, confirmed and verified), a real `assignRole` that changed
a seeded auditor to manager and back, and a real `addMember` that reverted
`IdentityNotActive` for a wallet with no identity.

### Six bugs the verification found

None of these were visible from a passing build.

1. **A visually hidden label widened the page by 332px.** `sr-only` is
   `position: absolute`, so inside a scrolling table with no positioned ancestor
   its containing block is the page and the scroller cannot clip it. One 1px
   "Actions" header pushed the document to 722px at a 390px viewport. Fixed by
   making each table scroller a containing block; `console-shots.mjs` now reports
   escaping positioned elements by name instead of just the symptom.
2. **The network chip read "No network" after any page load.** `address` and
   `chainId` are React state and do not survive navigation, while the session
   lives in a cookie. Worse than cosmetic: the wrong-network check could not fire
   at all. Fixed with a silent reconnect using `eth_accounts`, which never
   prompts.
3. **"Sign in to continue" when the chain was down.** The shell treated any
   failure from `/api/identity/me` as signed out. Now a 401 means signed out and
   anything else surfaces as "could not reach the chain", with the command that
   fixes it.
4. **"was NONE" beside the root admin's role.** The stored role is only worth
   showing when it disagrees with the effective one; the root admin has no stored
   record at all.
5. **`session.permissions` was typed as `string[]`** when the route actually
   returns `Record<PermissionKey, boolean>`. Every `.includes()` against it
   crashed the page the moment a real sign-in reached a screen that checked a
   permission — caught only by driving a real wallet through the app, not by
   inspection. Fixed the type and every call site.
6. **The change-role dialog always opened on "User"** regardless of the
   member's actual role. Split into an inner form keyed on the wallet, so
   switching targets remounts it and the selection starts on what that member
   actually holds.

### Verification

```
npm run check:contrast    60 checks, both themes          ✅
npm run typecheck                                          ✅
npm run lint                                               ✅
npm run build                                              ✅
npm run verify:api        130 assertions, real SIWE        ✅
npm run shots:console     44 captures, 2 themes, 1440/390  ✅ no overflow, no console errors
npm run check:states      wrong network, denied            ✅
npm run check:overflow    landing at 390                   ✅
```

`scripts/console-shots.mjs` is new. The existing `shots.mjs` cannot reach the
console because every screen is behind a wallet signature, so this one injects an
EIP-6963 provider that signs with a Hardhat test key through a Playwright
binding. The handshake, the signature and the session cookie are all real; only
the wallet UI is absent.

Six states were produced for real rather than mocked in a component: a tampered
record (stored hash flipped in Supabase, then restored), a revoked identity
(`revokeIdentity` on-chain, then reactivated), the chain stopped mid-session, a
wallet reporting mainnet, a real mint, and a real role change with its guard
reverting correctly for an invalid target.

### Known gaps going into Phase 6

- `verify-api.mjs` has automated coverage for `/api/applications` (12
  assertions) but not for `POST /api/organizations` — creating an organisation is
  a non-idempotent write with no clean rollback in the suite. Its guards (root
  admin check, hash-match refusal) were verified live via browser instead.
- The seeded demo data has accumulated extra assets from manual verification
  runs across sessions. Cosmetic only — run `npm run seed:all` against a fresh
  chain for a clean count before a demo.

## Phase 6 — Employee Portal ✅

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
| No data-fetching library | four screens need "load, show a skeleton, show the failure, reload". `lib/use-resource.ts` is 40 lines, and a library whose main feature is caching would work against the rule that roles are never cached |
| Read-only screens first, writes after review | a signed transaction is new surface area; the forms exist and state plainly that they are inert |
| Root admin unioned into the member roster | the seat comes from `createOrganization`, not `addMember`, so the contract's own enumeration omits it |
| Tri-state cells show default, override and result | a cell reading "Allowed" is indistinguishable from an unset cell whose default is already true, and only one of those survives a change to the defaults |

---

# Open items needing input

```
⬜ Supabase project URL + anon key + service role key   (blocks Phase 3 wiring)
⬜ Sepolia RPC URL + throwaway deployer private key     (blocks Phase 7)
⬜ Real asset photos for the demo, or use generated certificate cards
```
