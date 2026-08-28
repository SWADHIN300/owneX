# OwneX Evidence

This file maps project claims to the assertion or artifact that backs them. It
does not claim an external audit, production readiness, or mainnet safety.

## Verified Counts

| Claim | Evidence |
|---|---|
| 3 contracts | `contracts/IdentityRegistry.sol`, `contracts/OrgAccessManager.sol`, `contracts/AssetNFT.sol`; Sepolia addresses in `deployments/sepolia.json`. |
| 93 contract tests | `read/phase-2-tests-and-deploy.md`; re-run with `npm test`. |
| 86 API assertions | `read/phase-3-backend.md`; re-run against a live seeded stack with `npm run verify:api`. |
| 13 endpoint groups | Root README/API table and `read/phase-3-backend.md`; the code has more route files because several groups split by method or dynamic segment. |
| Sepolia only | `deployments/sepolia.json`, chain ID `11155111`. No mainnet deployment is recorded. |

## Sepolia Deployment Evidence

| Contract | Address | Transaction |
|---|---|---|
| IdentityRegistry | `0x0Ea36bBdB169957a9a12039E5cbCC677de5Fa8EC` | `0x25cb0cf3b48b7a3d7b73e8908b8ef30ce34cb67aa06fdfdeaff2d82c47473652` |
| OrgAccessManager | `0xb035648279247A82F298CBA4Eef364FaDa17B14F` | `0xa2b02d3a946896ff0e4b1cdee68e0ef6bd578cff18420cc9129210c5e2aaa231` |
| AssetNFT | `0x5e07bFDa18281ea3038E1AdCa27ff4aAe5dB37BA` | `0xfc686c47c9f049ae1a884f88637663816b51e2c4a4aa5e72e941ad9962e00eb0` |

Explorer:

- https://sepolia.etherscan.io/address/0x0Ea36bBdB169957a9a12039E5cbCC677de5Fa8EC
- https://sepolia.etherscan.io/address/0xb035648279247A82F298CBA4Eef364FaDa17B14F
- https://sepolia.etherscan.io/address/0x5e07bFDa18281ea3038E1AdCa27ff4aAe5dB37BA

## Security Properties

| Claim | Proof | On-chain evidence |
|---|---|---|
| A plain USER cannot mint. | `test/asset.test.ts:120`, "BLOCKS a plain user from minting", asserts `mintAsset` reverts with `MissingPermission` and the `PERM_MINT_ASSETS` argument. | Not recorded as a Sepolia demo transaction in this repo. A failed transaction can be recorded during the demo, but the contract proof is the test assertion. |
| The transfer lock blocks the holder. | `test/asset.test.ts:200`, "the holder CANNOT transfer the asset away", asserts both `transferFrom` and `safeTransferFrom` revert with `TransfersLocked` and ownership remains unchanged. | Not recorded as a Sepolia demo transaction in this repo. This should be one of the live demo moments. |
| The transfer lock also blocks approved operators. | `test/asset.test.ts:214`, "an approved third party still cannot move it"; `test/asset.test.ts:223`, "an operator approved for all still cannot move it"; both assert `TransfersLocked`. | Not recorded as a Sepolia demo transaction in this repo. |
| Nobody can self-promote. | `test/access.test.ts:177`, "nobody can promote themselves", proves a manager lacks permission and a full admin targeting itself reverts with `CannotTargetSelf`. | Not recorded as a Sepolia demo transaction in this repo. |
| The governance lockout guard prevents an org from disabling its own admins. | `test/access.test.ts:391`, "refuses to lock the organization out of its own governance", asserts `CannotDisableAdminGovernance` when trying to deny ADMIN `PERM_ASSIGN_ROLES` or `PERM_MANAGE_MEMBERS`. | Not recorded as a Sepolia demo transaction in this repo. |
| Revoking an identity drops roles and permissions. | `test/access.test.ts:405`, "a revoked identity instantly loses its role and every permission", checks `effectiveRole` becomes `ROLE_NONE`, `hasPermission` becomes false, and `isMember` becomes false after `revokeIdentity`. | The seed evidence has role/application setup transactions, but no recorded Sepolia revocation transaction. |
| Revoking an identity also drops application access. | `test/access.test.ts:460`, "a revoked identity is denied even while its role still has app access", checks `canAccessApp` becomes false after `revokeIdentity`. | The seeded Employee Portal application is documented in `deployments/sepolia.seed.json`; no revocation tx is recorded. |
| Revoking an identity breaks ownership verification. | `test/asset.test.ts:341`, "fails verification once the holder's identity is revoked", checks `verifyOwnership` returns false after `revokeIdentity`. | No recorded Sepolia revocation tx in this repo. |
| Automatic role expiry works without a transaction at expiry time. | `test/access.test.ts:229`, "a role lapses automatically once its expiry passes", advances time past expiry and verifies `effectiveRole` becomes `ROLE_NONE`, `hasPermission` is false, and `isMember` is false. | Sepolia seed includes a contractor membership with `expiresAt=1790521392` in `deployments/sepolia.seed.json`; expiry itself is a read-time condition. |
| Hash tamper detection works for identities. | `test/identity.test.ts:173`, "verifies a matching off-chain record and rejects a tampered one", checks `verifyIdentityHash` true for the original hash and false for a different hash. | Identity hashes are on Sepolia through the seed, but no tamper transaction is required; tampering is detected by comparison. |
| Hash tamper detection works for assets. | `test/asset.test.ts:371`, "detects a tampered off-chain asset record", checks `verifyAssetHash` true for the original asset hash and false for `ethers.id("tampered-record")`. | Sepolia seed records three asset hashes in `deployments/sepolia.seed.json`; mismatches are detected by read-time comparison. |
| API sessions do not cache roles. | `apps/platform/scripts/verify-api.mjs:183` reads `/api/identity/me`; `apps/platform/lib/session.ts` stores the wallet session, while role and permissions are read through the chain helpers. | No transaction evidence needed; this is API behavior plus code inspection. |
| `/api/roles/verify` is usable without a platform session. | `apps/platform/scripts/verify-api.mjs:509`, "role verification endpoint - what partner apps call", checks ADMIN, MANAGER, and USER are allowed with no session and stranger is denied. | Backed by `OrgAccessManager.canAccessApp` reads on the deployed/seeded chain. |
| Partner role checks do not expose email. | `apps/platform/scripts/verify-api.mjs:528`, "no email exposed to partner apps". | No transaction evidence needed. |
| Public metadata does not expose serial numbers or email. | `apps/platform/scripts/verify-api.mjs:247`, metadata checks verify `asset_hash` is present, live holder is read from chain, and serial/email are absent. | Metadata is served by API; token metadata URI is stored on-chain by asset minting. |

## Deployment and Demo Gaps

- Etherscan source-code verification was attempted in Phase 7 and timed out.
  The deployed addresses and transactions exist, but source verification should
  be retried with `npm run verify:sepolia`.
- The separate `apps/employee-portal` app is not present in this checkout. The
  platform endpoint and seeded application record exist, but the portal UI
  cannot be deployed or recorded from this repo as-is.
- No Sepolia transaction hash for the live `transferFrom` revert or revocation
  cascade is recorded in the repository yet. Those should be captured during the
  final demo if the video is produced.
- The Supabase service role key must be rotated before any public deployment
  because it was exposed in a previous chat log.
