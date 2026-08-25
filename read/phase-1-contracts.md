# Phase 1 — Smart contracts

**Finished:** 2026-08-26
**Stack:** Solidity 0.8.24 · OpenZeppelin 5.4 · Hardhat 2.29 · evm target `cancun`

---

## 1. What was built

Three contracts, layered so each depends only on the one below it.

```
AssetNFT              reads both contracts below
    ↓
OrgAccessManager      reads IdentityRegistry
    ↓
IdentityRegistry      root of trust, depends on nothing
```

### `contracts/IdentityRegistry.sol` (288 lines)

The root of trust. Every privileged action anywhere in the system eventually
asks this contract "is this wallet a live identity?"

```solidity
struct Identity {
    bytes32 identityHash;   // keccak256 of the encrypted off-chain profile
    bool exists;
    bool active;
    uint64 registeredAt;
}

struct Organization {
    bytes32 metadataHash;
    address rootAdmin;      // permanent bootstrap admin, transferable
    bool active;
    uint64 createdAt;
}
```

| Function | Caller |
|---|---|
| `registerIdentity(hash)` | anyone, for themselves — self-sovereign path |
| `registerIdentityFor(wallet, hash)` | registrars — admin onboarding path |
| `updateIdentityHash(hash)` | the wallet itself |
| `revokeIdentity(wallet)` | the wallet itself or a registrar |
| `reactivateIdentity(wallet)` | registrars |
| `createOrganization(hash)` | any active identity; caller becomes root admin |
| `updateOrganizationMetadata(orgId, hash)` | root admin |
| `setOrganizationActive(orgId, bool)` | root admin or platform owner |
| `transferOrgRootAdmin(orgId, newAdmin)` | root admin; target must be active |
| `setRegistrar(addr, bool)` | platform owner |

Views: `isActive`, `isRegistered`, `getIdentity`, `verifyIdentityHash`,
`getOrganization`, `isOrganizationActive`, `orgRootAdmin`, `organizationExists`.

Two registration paths exist because both onboarding models are real: a user who
arrives on their own, and an HR admin adding fifty employees. A registrar can
create the registry entry but can never act *as* that wallet — authentication
still requires the wallet's own signature.

### `contracts/OrgAccessManager.sol` (377 lines)

Per-organization RBAC. This is where "who may do what" lives.

```solidity
bytes32 ROLE_ADMIN   = keccak256("OWNEX_ROLE_ADMIN");
bytes32 ROLE_MANAGER = keccak256("OWNEX_ROLE_MANAGER");
bytes32 ROLE_AUDITOR = keccak256("OWNEX_ROLE_AUDITOR");
bytes32 ROLE_USER    = keccak256("OWNEX_ROLE_USER");

PERM_MANAGE_MEMBERS · PERM_ASSIGN_ROLES · PERM_MINT_ASSETS
PERM_TRANSFER_ASSETS · PERM_VIEW_AUDIT · PERM_MANAGE_APPS

enum Override { Unset, Allowed, Denied }

struct Membership { bytes32 role; uint64 joinedAt; uint64 expiresAt; }
```

| Function | Notes |
|---|---|
| `addMember(orgId, wallet, role, expiresAt)` | `expiresAt = 0` means permanent |
| `assignRole(orgId, wallet, role, expiresAt)` | self-targeting blocked; root admin untouchable |
| `setRoleExpiry(orgId, wallet, expiresAt)` | extend or shorten time-bound access |
| `removeMember(orgId, wallet)` | swap-and-pop keeps enumeration consistent |
| `setPermission(orgId, role, perm, Override)` | ADMIN only, with a lockout guard |
| `registerApplication(orgId, appId, hash)` | the Web2 SSO layer |
| `setAppAccess(orgId, appId, role, bool)` | per-role app gating |
| `canAccessApp(orgId, wallet, appId)` | the one call an integrated app makes |
| `effectiveRole(orgId, wallet)` | **the authoritative lookup** |
| `hasPermission(orgId, wallet, perm)` | override → default matrix fallthrough |

`effectiveRole` is the single most important function in the codebase. It returns
`ROLE_NONE` when the identity is revoked, when the membership has expired, or
when the wallet was never a member — three separate failure modes collapsed into
one answer, so no caller can forget to check one of them. The org root admin
always resolves to `ROLE_ADMIN`, which means an organization can never end up
with nobody able to govern it.

Default permission matrix, every cell overridable per organization:

| Permission | Admin | Manager | Auditor | User |
|---|:--:|:--:|:--:|:--:|
| Manage members | ✓ | | | |
| Assign roles | ✓ | | | |
| Mint assets | ✓ | | | |
| Transfer assets | ✓ | ✓ | | |
| View audit | ✓ | ✓ | ✓ | |
| Manage applications | ✓ | | | |

### `contracts/AssetNFT.sol` (359 lines)

`ERC721` + `ERC721Enumerable` + `ERC721URIStorage` + `Ownable` + `Pausable`.
Name `OwneX Asset Certificate`, symbol `OWNX`.

```solidity
struct Asset {
    uint256 orgId;
    bytes32 assetHash;      // keccak256 of the confidential off-chain record
    address assignedTo;
    bool active;
    uint64 mintedAt;
    uint32 transferCount;   // provenance depth, cheap for a dashboard to read
}
```

| Function | Permission |
|---|---|
| `mintAsset(orgId, assignedTo, assetHash, uri)` | `PERM_MINT_ASSETS` |
| `reassignAsset(tokenId, newHolder)` | `PERM_TRANSFER_ASSETS` |
| `revokeAsset(tokenId)` | `PERM_TRANSFER_ASSETS` — custody returns to root admin |
| `restoreAsset(tokenId, assignedTo)` | `PERM_TRANSFER_ASSETS` |
| `updateAssetRecord(tokenId, hash, uri)` | `PERM_MINT_ASSETS` |
| `pause` / `unpause` | platform owner |

Views: `verifyOwnership`, `verifyAssetHash`, `getAsset`, `assetsOfHolder`,
`assetsOfOrganization`, `organizationAssetCount`, `totalMinted`.

The transfer lock is implemented in the `_update` override:

```solidity
if (!isMint && !isBurn && !_orgControlledTransfer) {
    revert TransfersLocked(tokenId);
}
```

`_orgControlledTransfer` is set only inside `reassignAsset`, `revokeAsset`, and
`restoreAsset` — all three permission-gated. So a holder keeps genuine custody
and can prove it to anyone, but cannot sell the company laptop.

---

## 2. How it was verified

```
$ npx hardhat compile
Compiled 26 Solidity files successfully (evm target: cancun).
Generating typings for: 26 artifacts → 68 typings
```

Behavioural verification is Phase 2 (93 tests).

---

## 3. Decisions made

**Roles are storage mappings, not NFTs.** A role NFT is transferable, which would
let someone acquire Manager rights by buying a token. Membership here is bound to
the wallet and cannot be moved.

**Asset certificates are not freely tradeable.** A company laptop is not a
collectible. If an employee could sell the NFT, on-chain ownership would stop
reflecting reality the moment they did. Holder custody without alienability is
the correct model, and a plain ERC-721 cannot express it.

**Permissions are tri-state over a default matrix.** A fully static matrix is
inflexible; a fully dynamic one requires configuration transactions before a new
org can do anything. `Unset` / `Allowed` / `Denied` over sensible defaults gives
both: zero-config start, full customisation without redeployment.

**A governance lockout guard exists.** An org cannot set `Denied` on ADMIN's
`PERM_ASSIGN_ROLES` or `PERM_MANAGE_MEMBERS`. Without this, one transaction could
permanently brick an organization.

**Roles can expire.** `expiresAt` on the membership means a contractor's access
lapses at a block deadline rather than depending on someone remembering to
revoke it. This is not in the SIH problem statement — it is a deliberate addition
because it is how real organizations actually fail at access control.

**Only hashes go on-chain.** `identityHash` and `assetHash` are `keccak256` of
records that live encrypted off-chain. Re-hashing the off-chain record and
comparing proves it wasn't tampered with, while publishing nothing private. This
resolves the contradiction between "immutable audit trail" and "don't put
personal data on a public chain".

**Organizations are in `IdentityRegistry`, membership is in `OrgAccessManager`.**
Slight deviation from the original plan, which had `addMember` in the registry.
Keeping membership in one place only avoids duplicated state that could drift.

---

## 4. What this unblocks

Phase 2 (tests, deploy, seed) and — once deployed locally — Phase 3's backend,
which reads `effectiveRole` and `hasPermission` for every authorization decision.

---

## 5. Known gaps

- No social recovery or key rotation. A lost key means a lost identity, mitigated
  only by registrar `reactivateIdentity` and `transferOrgRootAdmin`.
- Single-admin organizations are a central point of failure. Production should
  use a multisig as root admin.
- Custom roles beyond the four constants are not supported. The override system
  covers most of the need; genuine custom roles would require a registry of
  role identifiers.
- No upgrade path. The contracts are immutable by design for a PoC; production
  would need a proxy pattern and a much more careful admin model.
- Not audited.
