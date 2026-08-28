# OwneX Architecture Diagrams

These diagrams are source, not screenshots. GitHub renders Mermaid blocks, and
the raw Markdown stays diffable.

## System Architecture

```mermaid
flowchart LR
  subgraph Browser["User browser"]
    Wallet["Wallet\nsigns SIWE messages\nsigns contract transactions"]
    Platform["Platform console\napps/platform"]
    Portal["Employee portal\nplanned separate app\nno keys, no chain client"]
  end

  subgraph Server["Next.js API layer\ntrust boundary: private data starts here"]
    Auth["Auth routes\nnonce, verify, logout"]
    RoleApi["/api/roles/verify\npublic integration endpoint"]
    AppApi["Platform API routes\nidentity, profile, assets, audit, members,\nroles matrix, applications, organizations"]
    Indexer["On-demand indexer\ncontract events to audit_cache"]
  end

  subgraph Offchain["Supabase\nprivate off-chain store"]
    Db["Postgres\nprofiles, organizations, assets,\napplications, nonces, audit_cache"]
    Storage["Storage\nasset images"]
  end

  subgraph Sepolia["Sepolia testnet\npublic on-chain state"]
    IR["IdentityRegistry\nidentity hashes, organizations,\nrevocation state"]
    OAM["OrgAccessManager\nroles, expiries, permissions,\napplication access"]
    NFT["AssetNFT\ntoken holder, asset hash,\nactive state, metadata URI"]
  end

  Wallet --> Platform
  Wallet --> Portal
  Platform --> Auth
  Platform --> AppApi
  Platform --> IR
  Platform --> OAM
  Platform --> NFT
  Portal --> RoleApi
  Auth --> Db
  RoleApi --> OAM
  RoleApi --> IR
  AppApi --> Db
  AppApi --> Storage
  AppApi --> IR
  AppApi --> OAM
  AppApi --> NFT
  Indexer --> Db
  Indexer --> IR
  Indexer --> OAM
  Indexer --> NFT
  NFT --> OAM
  OAM --> IR

  classDef private fill:#fff7d6,stroke:#8a6d00,color:#1f1a00;
  classDef public fill:#e6f1ff,stroke:#285a8f,color:#071d33;
  class Db,Storage,Auth,AppApi,RoleApi,Indexer private;
  class IR,OAM,NFT public;
```

Personal data stays on the API and Supabase side of the boundary. Sepolia holds
only public wallet addresses, roles, token state, timestamps, metadata URIs, and
`keccak256` hashes of private records.

## On-Chain Versus Off-Chain Split

```mermaid
flowchart TB
  subgraph Private["Off-chain private record\nSupabase, encrypted at rest"]
    Profile["Profile fields\nname, email, phone, department, title"]
    Org["Organization display record\nname, website, logo"]
    Asset["Asset record\nserial, invoice, description, image"]
    Canon["Canonical JSON\nstable key order"]
  end

  subgraph Public["On-chain public anchor\nSepolia contracts"]
    IdentityHash["IdentityRegistry.identityHash"]
    OrgHash["IdentityRegistry.organization.metadataHash"]
    AssetHash["AssetNFT.assetHash"]
  end

  Profile --> Canon
  Org --> Canon
  Asset --> Canon
  Canon --> Keccak["keccak256(record)"]
  Keccak --> IdentityHash
  Keccak --> OrgHash
  Keccak --> AssetHash

  Verify["Verification\nre-hash current off-chain record\ncompare with chain anchor"]
  Profile --> Verify
  Org --> Verify
  Asset --> Verify
  IdentityHash --> Verify
  OrgHash --> Verify
  AssetHash --> Verify

  Match["Match: record is unchanged"]
  Mismatch["Mismatch: private record was edited\nor bound to the wrong token"]
  Verify --> Match
  Verify --> Mismatch
```

The privacy claim is limited and concrete: the chain can prove whether an
off-chain record changed, but the chain does not contain the profile or asset
details themselves.

## Sign-In Sequence

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant W as Wallet
  participant P as Platform console
  participant A as Next.js API
  participant DB as Supabase
  participant C as Sepolia contracts

  U->>P: Connect wallet
  P->>A: POST /api/auth/nonce
  A->>DB: Store single-use nonce
  A-->>P: EIP-4361 message, gasRequired=false
  P->>W: Request personal signature
  W-->>P: Signature
  P->>A: POST /api/auth/verify
  A->>DB: Consume nonce if unused and unexpired
  A->>A: Check domain, chain id, address, message
  A-->>P: Set encrypted httpOnly session cookie
  P->>A: GET /api/identity/me
  A->>C: Read identity, effectiveRole, permissions, assets
  A-->>P: Session view with live role data
```

Signing in is gas-free because the wallet signs a message. Role checks after
sign-in still read from the contracts, so revocation is not delayed by cached
roles in the cookie.

## Cross-App Authorization Sequence

```mermaid
sequenceDiagram
  autonumber
  participant E as Employee portal
  participant W as Wallet
  participant A as Platform API
  participant C as Sepolia contracts
  participant S as Portal session

  E->>W: Ask user to prove wallet control
  W-->>E: Wallet address/signature
  E->>A: GET /api/roles/verify?wallet=...&orgId=1&app=employee-portal
  A->>C: effectiveRole(orgId, wallet)
  A->>C: canAccessApp(orgId, wallet, appId)
  A-->>E: allowed, role, reason, permissions
  E->>S: Create portal-local session if allowed
  E-->>E: Gate pages from platform answer
```

The portal is meant to hold no private keys and touch no blockchain provider. It
delegates the authorization question to `/api/roles/verify`. In this checkout,
the platform endpoint and seeded application exist, but the separate portal app
is not present.

## Revocation Cascade

```mermaid
sequenceDiagram
  autonumber
  participant Admin as Registrar or wallet owner
  participant IR as IdentityRegistry
  participant OAM as OrgAccessManager
  participant NFT as AssetNFT
  participant Portal as Employee portal/API client

  Admin->>IR: revokeIdentity(wallet)
  IR-->>Admin: IdentityRevoked event in block N
  Portal->>OAM: effectiveRole(orgId, wallet)
  OAM->>IR: isActive(wallet)
  OAM-->>Portal: ROLE_NONE
  Portal->>OAM: hasPermission(...)
  OAM->>IR: isActive(wallet)
  OAM-->>Portal: false
  Portal->>OAM: canAccessApp(orgId, wallet, appId)
  OAM->>IR: isActive(wallet)
  OAM-->>Portal: false
  Portal->>NFT: verifyOwnership(tokenId, wallet)
  NFT->>IR: isActive(wallet)
  NFT->>OAM: isMember(orgId, wallet)
  NFT-->>Portal: false
```

The revocation transaction writes only to `IdentityRegistry`. The cascade happens
because every dependent read checks identity liveness before returning a role,
permission, app access decision, or ownership verification.
