# Phase 2 — Tests, local deploy, demo seed

**Finished:** 2026-08-26
**Result:** 93 tests passing · deploy and seed verified against a live local node

---

## 1. What was built

### Test suites

| File | Tests | Covers |
|---|---|---|
| `test/identity.test.ts` | 24 | registration, registrars, kill switch, hash anchoring, organizations |
| `test/access.test.ts` | 34 | RBAC, self-promotion block, role expiry, overrides, app access |
| `test/asset.test.ts` | 35 | org-gated mint, transfer lock, revoke/restore, verification, pause |

Each suite uses `loadFixture` for state isolation, and `staffedFixture` /
`mintedFixture` for the common "org already populated" starting point.

### `scripts/deploy.ts`

Deploys all three contracts in dependency order, grants the platform admin
wallet registrar rights when it differs from the deployer, writes
`deployments/<network>.json`, and prints the `.env` lines to copy.

### `scripts/seed-demo.ts`

Builds the demo state so the dashboard has real on-chain data on first run:

```
Northwind Industries (org #1, root admin = signer #1)
├── 0x69FD…3888  ADMIN    ← your MetaMask wallet, funded with 10 local ETH
├── 0x3C44…93BC  MANAGER  Rahul Verma
├── 0x90F7…b906  AUDITOR  Neha Iyer
├── 0x15d3…6A65  USER     Arjun Mehta
└── 0x9965…A4dc  USER     Kavya Rao — role expires in 30 days
Employee Portal registered, all four roles granted access
Asset #1  Company Laptop 001              → Arjun Mehta
Asset #2  Professional Certificate ISO 9001 → Arjun Mehta
Asset #3  Design Suite License            → Rahul Verma
```

The script is idempotent — re-running it skips anything that already exists.

---

## 2. How it was verified

```
$ npx hardhat test
  93 passing (1s)

$ npx hardhat node          # terminal 1
$ npm run deploy:local      # terminal 2
IdentityRegistry  0x5FbDB2315678afecb367f032d93F642f64180aa3
OrgAccessManager  0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
AssetNFT          0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
saved → deployments/localhost.json

$ npm run seed:local
organization      #1
members           5
assets minted     3
your wallet role  ADMIN  (0x69FD94d7e3F931F80B658872B70dF5CCa4263888)
```

Re-verified after the rename from the earlier working name to OwneX: recompiled,
93 still passing, deploy and seed re-run clean.

### The security assertions that now have proof

These are the ones that matter on demo day, because each is a way the system
could have been broken:

```
✓ a plain USER calling mintAsset reverts with MissingPermission
✓ a MANAGER and an AUDITOR also cannot mint by default
✓ a holder calling transferFrom reverts with TransfersLocked
✓ an approved third party still cannot move a locked asset
✓ an approve-for-all operator still cannot move a locked asset
✓ nobody can promote themselves — including a full ADMIN targeting itself
✓ the org root admin's seat cannot be altered through RBAC
✓ an org cannot deny ADMIN its own governance permissions
✓ a revoked identity loses every role, permission, and app access in one block
✓ a suspended organization freezes every permission inside it
✓ a role with an expiry lapses automatically, no transaction needed
✓ verifyOwnership fails on revoked identity, revoked asset, suspended org,
  or lost membership
✓ minting to a non-member or a revoked identity reverts
✓ pausing halts mint, reassign, and revoke while leaving reads available
✓ unknown token ids revert rather than returning garbage
✓ zero addresses and empty hashes are rejected everywhere
```

The first three are proof moment #1 of the demo. The revocation cascade is
proof moment #2.

---

## 3. Decisions made

**Tests assert reverts by custom error, not by string.** `revertedWithCustomError`
with `withArgs` means a test fails if the wrong error fires, which catches
accidental logic changes that a generic "it reverted" assertion would miss.

**`anyValue` for block timestamps.** Pinning exact timestamps makes tests flaky.

**The seed funds the browser wallet on localnet.** `hardhat_setBalance` gives
`0x69FD…3888` 10 ETH so MetaMask can transact against the local node immediately,
with no faucet and no account import. Guarded to local networks only.

**The seed makes your wallet ADMIN but not root admin.** Root admin stays with a
scripted signer so the script can perform setup without your wallet signing
anything. Your wallet gets full ADMIN permissions, which is everything needed to
drive the demo.

**One contractor has an expiring role.** So the time-bound access feature is
demonstrable from seeded data rather than needing a live setup step.

**`typescript` pinned to `5.7.3`.** TypeScript 7 shipped and broke `ts-node` on
Node 25 with `Cannot read properties of undefined (reading 'fileExists')`.
Do not unpin this.

---

## 4. What this unblocks

Phase 3. The backend can now point at real deployed addresses on localhost and
read `effectiveRole` / `hasPermission` for authorization, and Phase 5's dashboard
will have populated data to render instead of empty states.

---

## 5. Known gaps

- No `solidity-coverage` run yet. Coverage is high on access-control paths by
  construction but not measured. Worth running before submission.
- No gas benchmarking. `REPORT_GAS=true` is wired but unused.
- No fuzz or invariant testing. Reasonable to skip for a PoC; worth mentioning
  as future work if a judge asks about test depth.
- Nothing deployed to Sepolia yet — that is Phase 7.
- Metadata URIs in the seed point at `http://localhost:3000/api/metadata/<id>`,
  which will 404 until Phase 3 builds that route.
