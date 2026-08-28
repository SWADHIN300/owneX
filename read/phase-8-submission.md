# Phase 8 — Documentation, Demo, and Deployment Handover

**Prepared:** 2026-08-28
**Status:** partial and honest. Documentation is complete; recording and public
deployment are blocked by missing application source and hosting credentials.

## Deliverables

| Deliverable | Location | Status |
|---|---|---|
| README for evaluators, local developers, and security reviewers | `README.md` | Complete |
| System, privacy, sign-in, cross-app, and revocation diagrams | `read/architecture.md` | Complete as Mermaid source |
| Claim-to-test and Sepolia evidence matrix | `read/evidence.md` | Complete from recorded tests and deployment artifacts |
| Timed three-to-four minute demo script | `read/demo-script.md` | Complete; live cross-app segment is blocked |
| Web manifest and Open Graph route | `apps/platform/app/manifest.ts`, `apps/platform/app/opengraph-image.tsx` | Complete; must be checked on the eventual deployment |
| Platform deployment | Hosting configuration | Not performed |
| Employee Portal deployment | `apps/employee-portal` | Blocked: directory is absent |
| Recorded demo video | Recording artifact | Not performed |

## Evidence Verified During This Phase

- `npm test` completed with **93 passing** contract tests on 2026-08-28.
- The recorded Sepolia deployment consists of three contracts at the addresses in
  `read/phase-7-sepolia.md`.
- The API verification count of **86 assertions** is documented from the Phase 3
  live-stack run. It was not rerun here because a live configured platform stack
  is not running in this checkout.
- The API surface is documented as **13 endpoint groups**.

## Blocking Conditions

- `apps/employee-portal` is not present, so its source cannot be built, tested,
  deployed, or used to record the cross-app login segment.
- No production hosting project, production URLs, or environment-variable access
  is available. Deployment must set secrets in the host, rotate the Supabase
  service role key first, and allowlist the final portal redirect URI.
- No recorded Sepolia transaction currently demonstrates the holder's
  `TransfersLocked` revert or the revocation cascade. The tests prove both;
  recording must capture real live transactions before claiming the demo is done.
- Etherscan source verification was attempted in Phase 7 but timed out. Retry
  `npm run verify:sepolia` when the explorer API is reachable.

## Required Final Checks After Deployment

1. Verify the platform's icon, manifest, and Open Graph image over the deployed
   URL.
2. Check both themes, keyboard-only navigation, reduced motion, and a 390px
   viewport on the deployed site.
3. Confirm `redirect_uri` allowlisting for the portal production URL.
4. Run platform checks and portal checks against the final configuration.
5. Record the real reverted transfer and revocation cascade, then add their
   transaction hashes to `read/evidence.md`.

## Security Position

OwneX remains a Sepolia-only proof of concept. It has no external security
review, no end-user key recovery, no rate limit on public auth or role endpoints,
and an on-demand indexer. The guardian model, zero-knowledge selective
disclosure, ERC-4337 paymasters, Merkle batching, and NFC/QR binding are planned,
not implemented.
