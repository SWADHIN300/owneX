# OwneX

**Own it. Prove it.** — verifiable identity, access, and ownership.

A blockchain platform for decentralized identity, organization-wide role-based
access control, and NFT-backed asset ownership — with a tamper-evident audit
trail. Built for SIH.

---

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Smart contracts | **done** |
| 2 | Tests + local deploy + demo seed | **done — 93 tests passing** |
| 3 | Backend: SIWE auth, role API, Supabase | pending |
| 4 | Design system + landing | pending |
| 5 | Platform dashboard | pending |
| 6 | Employee Portal (second app, proves cross-app SSO) | pending |
| 7 | Sepolia deploy + polish | pending |
| 8 | README, diagrams, demo video | pending |

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│  Platform app   │     │ Employee Portal  │   ← contains NO contract code
│  Next.js + UI   │     │ Next.js          │     gets identity + role from the
└────────┬────────┘     └────────┬─────────┘     platform's role API
         │                       │
         └───────────┬───────────┘
                     │  SIWE signature → httpOnly session
         ┌───────────▼────────────┐
         │  Next.js Route Handlers│  nonce · verify · /identity/me · /roles/verify
         └───────────┬────────────┘
                     │
     ┌───────────────┴────────────────┐
     │                                │
┌────▼─────────────┐        ┌─────────▼──────────┐
│ Supabase         │        │  Ethereum (Sepolia)│
│ profiles, assets │        │  3 contracts       │
│ audit cache      │        │  events = audit    │
│ encrypted PII    │        └────────────────────┘
└──────────────────┘
```

### The three contracts

| Contract | Responsibility |
|---|---|
| `IdentityRegistry` | Wallet-bound identities, organizations, the revocation kill switch. Root of trust. |
| `OrgAccessManager` | Per-org RBAC: Admin / Manager / Auditor / User, permission matrix, time-bound roles, application access. |
| `AssetNFT` | ERC-721 asset certificates. Org-gated minting, non-tradeable holder custody, revocation, hash verification. |

### What is on-chain vs off-chain

```
ON-CHAIN (source of truth)          OFF-CHAIN (Supabase, encrypted)
──────────────────────────          ────────────────────────────────
identity hash                       name, email, phone
organization + root admin           org profile, logo
role + expiry                       department, job title
NFT token id + holder               asset name, description, image
asset hash                          serial numbers, documents
every audit event                   cached events for fast paging
metadata URI                        the metadata JSON itself
```

No personal data ever touches the chain. Only `keccak256` anchors. Re-hashing the
off-chain record and comparing it to the anchor proves the record was not
tampered with — without publishing anything private.

---

## Setup

```bash
npm install
cp .env.example .env      # fill in as you reach each phase
npm run compile
npm test
```

### Run the local chain with demo data

```bash
npx hardhat node          # terminal 1 — 20 funded test accounts
npm run deploy:local      # terminal 2
npm run seed:local
```

The seed script builds **Northwind Industries** with five members across all four
roles, a registered Employee Portal, three minted asset certificates, and it
funds your MetaMask wallet with 10 local ETH so you can drive the demo from the
browser immediately.

MetaMask local network:

```
Network name : Hardhat Local
RPC URL      : http://127.0.0.1:8545
Chain ID     : 31337
Currency     : ETH
```

### Deploy to Sepolia

Sepolia ETH is free faucet money with no real value. **No real ETH is needed at
any point in this project.**

```bash
# .env
SEPOLIA_RPC_URL=...
DEPLOYER_PRIVATE_KEY=...   # throwaway wallet, faucet ETH only

npm run deploy:sepolia
```

---

## Design decisions worth defending

**Roles are storage mappings, not NFTs.** A role NFT could be sold or
transferred, which would let anyone acquire Manager rights. Membership here is
bound to the wallet and cannot be moved.

**Asset certificates are not freely tradeable.** A company laptop is not a
collectible. Holder-initiated `transferFrom` reverts with `TransfersLocked`;
movement happens only through `reassignAsset` / `revokeAsset`, which require an
organization permission. The employee still holds the token and can prove
custody — they simply cannot alienate it.

**Permissions are tri-state over a default matrix.** A brand-new organization
works with zero configuration transactions, yet any org can `Allow` or `Deny` any
permission for any role without a redeployment. A guard prevents an org from
denying ADMIN its own governance permissions and locking itself out permanently.

**Roles can expire.** A contractor's Manager role lapses at a block deadline
instead of depending on somebody remembering to revoke it.

**Revocation cascades instantly.** Revoking an identity drops `effectiveRole` to
`ROLE_NONE` everywhere at once — every organization, every permission, every
connected application, and ownership verification too.

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

Any cell is overridable per organization.

---

## Tests

```
93 passing

IdentityRegistry   24  registration, registrars, kill switch, hash anchoring, orgs
OrgAccessManager   34  RBAC, self-promotion block, expiry, overrides, app access
AssetNFT           35  org-gated mint, transfer lock, revocation, verification, pause
```

The security-critical assertions:

- a plain user calling `mintAsset` reverts with `MissingPermission`
- a holder calling `transferFrom` reverts with `TransfersLocked`
- an approved operator still cannot move a locked asset
- nobody can promote themselves, including a full admin
- an org cannot deny ADMIN its own governance permissions
- a revoked identity loses every role, permission, and app access immediately
- a suspended organization freezes every permission inside it
- `verifyOwnership` fails on revoked identity, revoked asset, suspended org, or lost membership

---

## The demo path

```
Admin creates org → registers Bob (USER) → registers Carol (MANAGER)
→ mints "Company Laptop 001" → assigns to Bob
→ Bob logs into Employee Portal: sees the laptop, no mint button
→ Bob calls mintAsset() directly in the console → contract REVERTS      ← proof 1
→ Admin revokes Bob's identity → Bob's portal access denied on next check ← proof 2
→ Auditor opens the Audit Trail → every event verified on Sepolia Etherscan
```

The revert and the revocation are the two moments that prove the security model.
Everything else is presentation.

---

## Known limitations

Stated plainly, because they are design realities rather than bugs:

- **Key loss.** Losing a wallet means losing access. Production needs social
  recovery, key rotation, or an institutional recovery process.
- **An NFT is not legal title.** The chain proves a wallet holds a token. It does
  not prove a person legally owns a physical laptop. Legal ownership needs an
  organizational policy layer on top.
- **Public chain, public metadata.** Roles and asset counts are visible on-chain.
  Personal data is deliberately kept off-chain and encrypted.
- **Admin concentration.** A single org admin is a central point of failure.
  Production should use a multisig admin.
- **Not audited.** This is a hackathon proof of concept, not audited production
  code.

---

## Licence

MIT
