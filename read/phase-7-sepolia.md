# Phase 7 — Sepolia deployment and polish

**Date:** 2026-08-28  
**Network:** Sepolia (`11155111`)  
**Deployer:** `0x69FD94d7e3F931F80B658872B70dF5CCa4263888`

## Deployment

The root `.env` contains the required Sepolia RPC, deployer, and Etherscan
configuration. It is ignored by git and no secret values are recorded here.
Preflight passed with `5.053 ETH` of Sepolia test ETH.

| Contract | Address | Deployment transaction |
|---|---|---|
| IdentityRegistry | `0x0Ea36bBdB169957a9a12039E5cbCC677de5Fa8EC` | `0x25cb0cf3b48b7a3d7b73e8908b8ef30ce34cb67aa06fdfdeaff2d82c47473652` |
| OrgAccessManager | `0xb035648279247A82F298CBA4Eef364FaDa17B14F` | `0xa2b02d3a946896ff0e4b1cdee68e0ef6bd578cff18420cc9129210c5e2aaa231` |
| AssetNFT | `0x5e07bFDa18281ea3038E1AdCa27ff4aAe5dB37BA` | `0xfc686c47c9f049ae1a884f88637663816b51e2c4a4aa5e72e941ad9962e00eb0` |

Explorer links:

- https://sepolia.etherscan.io/address/0x0Ea36bBdB169957a9a12039E5cbCC677de5Fa8EC
- https://sepolia.etherscan.io/address/0xb035648279247A82F298CBA4Eef364FaDa17B14F
- https://sepolia.etherscan.io/address/0x5e07bFDa18281ea3038E1AdCa27ff4aAe5dB37BA

## Seed

`npm run seed:sepolia` is resumable and completed organization #1, the Employee
Portal application, role access, and three assets. `npm run seed:offchain`
completed against Supabase using `deployments/sepolia.seed.json`.

The demo now has four distinct role addresses: manager
`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, auditor
`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`, employee
`0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`, and contractor
`0xBe98A6Ec74E921409F2d26E0Fd56b344E1be0FA6`. The deployer remains the
platform and organization root admin.

## Verification and remaining work

- `npm test`: 93 passing.
- Platform lint, typecheck, build, contrast checks, and 390px overflow checks pass.
- ABI export completed for all three contracts.
- Etherscan verification was attempted twice and both attempts failed with a
  block-explorer connection timeout. Retry `npm run verify:sepolia` when the
  Etherscan API is reachable.
- The browser state harness reaches the app after its localhost origin fix,
  but its permission-denied path still expects the old local chain (`31337`)
  and local Hardhat test keys. Run that diagnostic against a local config or
  parameterize it for Sepolia before treating it as a Sepolia QA result.
- `apps/employee-portal` does not exist in this checkout, so the separate
  employee-portal flow remains blocked. The four-account wallet seed is ready.

## Repeatable commands

```text
npm run preflight:sepolia
npm run deploy:sepolia
npm run verify:sepolia
npm run seed:sepolia
npm run config:platform:sepolia
npm run export:abi
npm run seed:offchain
```
