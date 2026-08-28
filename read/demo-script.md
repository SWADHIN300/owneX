# OwneX Demo Script

Target length: 3 to 4 minutes. Do not fake the reverted transfer or the
revocation cascade. If a live step fails, say what failed and show the fallback
evidence from `read/evidence.md`.

## Before Recording

- Use Sepolia only.
- Keep `.env`, private keys, mnemonics, RPC credentials, Supabase keys, and
  browser extension secret screens out of frame.
- Rotate the Supabase service role key before recording a public deployment.
- Confirm the platform is pointed at the Sepolia addresses in
  `deployments/sepolia.json`.
- Confirm the Employee Portal exists and is deployed. In this checkout it is not
  present, so this part is blocked until the portal app is added.
- Have Etherscan tabs ready for the three contracts and any demo transactions.

## Script

| Time | Screen | Narration | Required proof |
|---|---|---|---|
| 0:00 | Landing page or README summary | "OwneX separates private identity and asset records from public authorization. Central databases can be edited silently; this project anchors the parts that must be auditable on Sepolia." | Show "testnet only" status. |
| 0:20 | Wallet sign-in | "Signing in uses a wallet signature, not a password. This is gas-free: no transaction, no fee, only a signed EIP-4361 message." | Show nonce/signature flow and successful dashboard session. |
| 0:45 | Console identity/profile | "The profile lives off-chain. The chain stores only the hash, so reviewers can detect tampering without seeing the private record." | Show identity hash and record-intact state. |
| 1:15 | Mint wizard or asset vault | "An admin can draft an asset record, anchor its hash, then mint a certificate to the holder." | Show token/asset hash and transaction hash. |
| 1:45 | Asset detail from holder account | "A different account can verify custody without asking the platform operator to vouch for it." | Show `verifyOwnership`/holder and Etherscan token state if available. |
| 2:10 | Wallet or console transaction attempt | "Now the important negative test: the holder tries `transferFrom`. The asset is in their wallet, but company assets are not tradeable." | The transaction must revert with `TransfersLocked`; do not simulate with copy. |
| 2:30 | Employee Portal | "This is the cross-app point. The portal should not hold keys or read the chain. It asks OwneX whether this wallet can access the app." | Blocked until `apps/employee-portal` exists. Platform `/api/roles/verify` is available as fallback evidence. |
| 3:00 | Revoke identity | "One revocation transaction changes every dependent read: role, permissions, application access, and ownership verification." | Show `revokeIdentity` tx, then reload portal/API result and show access denied. |
| 3:20 | Etherscan | "The audit trail is public and append-only on Sepolia. The off-chain display can be rebuilt from these events." | Show deployment or demo tx hashes on Etherscan. |
| 3:40 | Limitations slide/README | "This is a testnet proof of concept. It is not audited, has no end-user key recovery yet, no rate limiting on public auth and role endpoints, and the indexer runs on demand." | Show limitations section. |

## Recording Notes

- Spend real time on the `TransfersLocked` revert and the revocation reload; they
  are the strongest proof points.
- Avoid claims about production readiness, audits, partnerships, users, or
  mainnet safety.
- Label zero-knowledge selective disclosure, ERC-4337 paymasters, Merkle
  batching, and NFC/QR physical binding as planned only if they are mentioned.
