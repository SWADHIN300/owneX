# Phase 6 — Employee Portal

The employee portal is a separate Next.js app on port 3001 with no blockchain dependencies or contract code. Login stores a random state in the portal's encrypted, httpOnly session, then redirects to platform authorization. The platform requires SIWE, validates the exact registered callback, and issues a random two-minute code bound to app and redirect URI. The portal exchanges it server-to-server and creates its own cookie.

Codes are server-side, never encode a wallet, expire after two minutes, and are marked used on exchange; replay returns `CODE_REJECTED`. Callback state is checked before exchange, preventing CSRF. Protected requests call `/api/roles/verify` without caching, so revocation, expiry, suspension, and app-access changes appear immediately. Every reason code has a specific denied message.

Assigned assets are read through a server-side platform route. No wallet input, keys, RPC URL, ABI, or chain client exists in the portal package.

The authorization-code store is process-local for the local demonstration. Production should move the same consume-once semantics to Supabase with a unique code, expiry index, and conditional `used_at is null` update.
