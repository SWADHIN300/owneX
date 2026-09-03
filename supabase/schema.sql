-- ═══════════════════════════════════════════════════════════════════════
-- OwneX — Supabase schema
--
-- Run this in the Supabase SQL editor, or:
--   psql "$SUPABASE_DB_URL" -f supabase/schema.sql
--
-- SECURITY MODEL
--   Row Level Security is enabled on every table and NO permissive policies
--   are created. That means the anon and authenticated keys can read nothing.
--   All access goes through Next.js route handlers using the service role key,
--   which bypasses RLS and is never exposed to the browser.
--
--   This is deliberate: authorization in OwneX is decided by on-chain role
--   lookups, not by Supabase Auth. Postgres must not be a second, divergent
--   source of truth for who may see what.
--
-- WHAT LIVES HERE
--   Private, large, or frequently-changing data. The chain remains the source
--   of truth for identities, roles, ownership, and audit events. Anything in
--   this database is a cache or a private detail — if the two ever disagree,
--   the chain wins.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ───────────────────────────────────────────────────────────────────────
-- profiles — private detail behind an on-chain identity
-- The on-chain identityHash is keccak256 of the canonical form of these
-- fields, so tampering here is detectable by re-hashing and comparing.
-- ───────────────────────────────────────────────────────────────────────
create table if not exists profiles (
  wallet_address   text primary key
                   check (wallet_address ~ '^0x[a-fA-F0-9]{40}$'),
  display_name     text not null,
  job_title        text,
  department       text,
  email_encrypted  text,          -- AES-256-GCM, never plaintext
  phone_encrypted  text,          -- AES-256-GCM, never plaintext
  avatar_url       text,
  identity_hash    text,          -- mirror of the on-chain anchor
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table profiles is
  'Private profile detail. email/phone are AES-256-GCM ciphertext. Never store plaintext PII.';

-- ───────────────────────────────────────────────────────────────────────
-- organizations — display detail for an on-chain org id
-- ───────────────────────────────────────────────────────────────────────
create table if not exists organizations (
  org_id         bigint primary key,     -- matches IdentityRegistry orgId
  name           text not null,
  industry       text,
  description    text,
  logo_url       text,
  website        text,
  metadata_hash  text,                   -- mirror of the on-chain anchor
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────
-- assets — display + confidential detail for an on-chain token
--
-- Rows are created BEFORE minting, because the metadata URI must exist before
-- it can be passed into mintAsset(). `token_id` stays null until the mint is
-- confirmed against the chain, at which point the row is bound to a real token.
--
-- A token id is meaningful only together with the contract that issued it: every
-- AssetNFT deployment starts counting at 1, so uniqueness is per deployment, not
-- global. Rows from an old deployment must not be able to block the new mint
-- that legitimately owns the same id.
--
-- Ownership is NOT stored here. Ownership comes from AssetNFT.ownerOf().
-- ───────────────────────────────────────────────────────────────────────
create table if not exists assets (
  id                uuid primary key default gen_random_uuid(),
  token_id          bigint,               -- null until minted and confirmed
  chain_id          bigint,               -- the chain the binding belongs to
  contract_address  text                  -- the AssetNFT that issued token_id
                    check (contract_address is null or contract_address ~ '^0x[0-9a-f]{40}$'),
  org_id            bigint not null references organizations (org_id) on delete cascade,
  name              text not null,
  description       text,
  asset_type        text not null,        -- Laptop | Certificate | License | Equipment
  department        text,
  image_url         text,
  serial_encrypted  text,                 -- AES-256-GCM, never plaintext
  invoice_encrypted text,                 -- AES-256-GCM, never plaintext
  asset_hash        text not null,        -- must equal the on-chain anchor
  metadata_uri      text not null,
  mint_tx_hash      text,
  created_by        text,                 -- wallet that drafted it
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists assets_org_idx on assets (org_id);
create index if not exists assets_type_idx on assets (asset_type);
create index if not exists assets_token_idx on assets (token_id);
create index if not exists assets_pending_idx on assets (org_id) where token_id is null;
create index if not exists assets_deployment_idx on assets (contract_address, org_id);

-- One row per token per deployment. `coalesce` because a unique index treats
-- NULLs as distinct, which would exempt unstamped rows from the guard.
create unique index if not exists assets_token_per_deployment_key
  on assets (coalesce(contract_address, 'unstamped'), token_id)
  where token_id is not null;

comment on column assets.asset_hash is
  'keccak256 of the confidential record. Must match AssetNFT.getAsset().assetHash.';
comment on column assets.token_id is
  'Null while the asset is a draft. Set only after the mint is verified on-chain, and unique per (contract_address, token_id).';
comment on column assets.contract_address is
  'The AssetNFT that issued token_id, lowercase. Null on rows that predate deployment scoping.';


-- ───────────────────────────────────────────────────────────────────────
-- applications — third-party websites that authenticate through OwneX
--
-- "Sign in with OwneX" is an authorization-code flow, so each application has
-- integration configuration: a public client id, the scrypt digest of a client
-- secret, exact callback URLs, and a status. appId on-chain is keccak256(slug).
--
-- NOTHING HERE DECIDES WHO MAY SIGN IN. Whether a role may reach an application
-- is read from OrgAccessManager.canAccessApp on every request. `allowed_roles`
-- records only what an admin intended to grant, so the dashboard can point out
-- an intention that was never signed on-chain.
-- ───────────────────────────────────────────────────────────────────────
create table if not exists applications (
  org_id                    bigint not null references organizations (org_id) on delete cascade,
  app_slug                  text not null,             -- e.g. 'employee-portal'
  app_id                    text not null,             -- keccak256(app_slug), the on-chain key
  name                      text not null,
  url                       text not null,             -- homepage
  description               text,
  logo_url                  text,
  client_id                 text,                      -- public, unguessable
  client_secret_hash        text,                      -- scrypt$N$r$p$salt$digest — never plaintext
  client_secret_updated_at  timestamptz,
  allowed_roles             text[] not null default '{}'::text[],
  status                    text not null default 'draft',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  primary key (org_id, app_slug),
  constraint applications_status_check
    check (status in ('draft', 'active', 'revoked')),
  constraint applications_allowed_roles_check
    check (allowed_roles <@ array['ADMIN','MANAGER','AUDITOR','USER']::text[]),
  constraint applications_client_id_format_check
    check (client_id is null or client_id ~ '^ownex_[0-9a-f]{32}$')
);

create index if not exists applications_app_id_idx on applications (app_id);
create index if not exists applications_status_idx on applications (status);
create unique index if not exists applications_client_id_key
  on applications (client_id) where client_id is not null;

comment on column applications.client_secret_hash is
  'scrypt digest of the client secret. The plaintext is shown once at generation and never stored.';
comment on column applications.status is
  'draft | active | revoked. A revoked integration is refused at /authorize and at code exchange without deleting audit history.';

-- ───────────────────────────────────────────────────────────────────────
-- application_callbacks — the exact redirect URIs an application may use
--
-- A table rather than a JSON column so the constraints are real: absolute
-- http(s), no query string or fragment, unique per application, cascading with
-- the application. Exact-match lookup is an index hit. There are no wildcards
-- anywhere in this system.
-- ───────────────────────────────────────────────────────────────────────
create table if not exists application_callbacks (
  id            uuid primary key default gen_random_uuid(),
  org_id        bigint not null,
  app_slug      text   not null,
  callback_url  text   not null,
  created_at    timestamptz not null default now(),

  constraint application_callbacks_app_fk
    foreign key (org_id, app_slug)
    references applications (org_id, app_slug)
    on delete cascade,
  constraint application_callbacks_unique
    unique (org_id, app_slug, callback_url),
  constraint application_callbacks_url_check
    check (
      callback_url ~ '^https?://[^\s?#]+$'
      and length(callback_url) between 8 and 2048
    )
);

create index if not exists application_callbacks_lookup_idx
  on application_callbacks (org_id, app_slug);
create index if not exists application_callbacks_url_idx
  on application_callbacks (callback_url);

-- ───────────────────────────────────────────────────────────────────────
-- audit_cache — contract events, indexed for fast paging
-- The chain is authoritative. This exists so the Audit Trail page does not
-- hit an RPC provider on every scroll.
-- ───────────────────────────────────────────────────────────────────────
create table if not exists audit_cache (
  id              uuid primary key default gen_random_uuid(),
  contract_name   text not null,          -- IdentityRegistry | OrgAccessManager | AssetNFT
  event_name      text not null,
  org_id          bigint,
  actor_wallet    text,                   -- who performed the action
  subject_wallet  text,                   -- who or what it was done to
  token_id        bigint,
  tx_hash         text not null,
  block_number    bigint not null,
  log_index       integer not null,
  block_time      timestamptz,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (tx_hash, log_index)             -- idempotent re-indexing
);

create index if not exists audit_org_block_idx on audit_cache (org_id, block_number desc);
create index if not exists audit_actor_idx on audit_cache (actor_wallet);
create index if not exists audit_subject_idx on audit_cache (subject_wallet);
create index if not exists audit_token_idx on audit_cache (token_id);
create index if not exists audit_event_idx on audit_cache (event_name);

-- ───────────────────────────────────────────────────────────────────────
-- indexer_state — resume point per contract so re-indexing is cheap
-- ───────────────────────────────────────────────────────────────────────
create table if not exists indexer_state (
  contract_address text primary key,
  contract_name    text not null,
  chain_id         bigint not null,
  last_block       bigint not null default 0,
  updated_at       timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────
-- nonces — SIWE replay protection
-- Single use, short TTL, bound to one wallet.
-- ───────────────────────────────────────────────────────────────────────
create table if not exists nonces (
  nonce          text primary key,
  wallet_address text not null,
  domain         text not null,
  issued_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  used_at        timestamptz
);

create index if not exists nonces_wallet_idx on nonces (wallet_address);
create index if not exists nonces_expiry_idx on nonces (expires_at);

-- ───────────────────────────────────────────────────────────────────────
-- authorization_codes — single-use "Sign in with OwneX" grants
--
-- Random, 2-minute, one-time, and bound to the client id, organization and the
-- exact redirect URI they were issued against. Consumption is a conditional
-- UPDATE ... WHERE used_at IS NULL, so two simultaneous exchanges cannot both
-- succeed and a replay gets nothing back.
-- ───────────────────────────────────────────────────────────────────────
create table if not exists authorization_codes (
  code           text primary key,
  client_id      text not null,
  app_slug       text not null,
  org_id         bigint not null,
  wallet_address text not null,
  redirect_uri   text not null,
  issued_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  constraint authorization_codes_wallet_check
    check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  constraint authorization_codes_redirect_check
    check (redirect_uri ~ '^https?://[^\s]+$')
);

create index if not exists authorization_codes_expiry_idx on authorization_codes (expires_at);
create index if not exists authorization_codes_wallet_idx on authorization_codes (wallet_address);
create index if not exists authorization_codes_pending_idx
  on authorization_codes (client_id, expires_at) where used_at is null;

comment on table authorization_codes is
  'Single-use, 2-minute authorization codes. Consumed atomically so a replay cannot succeed.';

comment on table nonces is
  'A nonce is valid only if unused and unexpired. Consumed atomically on verify.';

-- ───────────────────────────────────────────────────────────────────────
-- Housekeeping: drop grants that were never redeemed
-- ───────────────────────────────────────────────────────────────────────
create or replace function purge_expired_authorization_codes() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from authorization_codes where expires_at < now() - interval '1 hour';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────
-- Housekeeping: drop nonces that were never redeemed
-- ───────────────────────────────────────────────────────────────────────
create or replace function purge_expired_nonces() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from nonces where expires_at < now() - interval '1 hour';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────
-- updated_at maintenance
-- ───────────────────────────────────────────────────────────────────────
create or replace function touch_updated_at() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on profiles;
create trigger profiles_touch before update on profiles
  for each row execute function touch_updated_at();

drop trigger if exists organizations_touch on organizations;
create trigger organizations_touch before update on organizations
  for each row execute function touch_updated_at();

drop trigger if exists assets_touch on assets;
create trigger assets_touch before update on assets
  for each row execute function touch_updated_at();

drop trigger if exists applications_touch on applications;
create trigger applications_touch before update on applications
  for each row execute function touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════
-- Row Level Security — on everywhere, permissive policies nowhere.
-- Only the service role key (server side) can read or write.
-- ═══════════════════════════════════════════════════════════════════════
alter table profiles       enable row level security;
alter table organizations  enable row level security;
alter table assets         enable row level security;
alter table applications   enable row level security;
alter table application_callbacks enable row level security;
alter table audit_cache    enable row level security;
alter table indexer_state  enable row level security;
alter table nonces         enable row level security;
alter table authorization_codes enable row level security;

-- Belt and braces: revoke the default grants Supabase hands to anon.
revoke all on profiles      from anon, authenticated;
revoke all on organizations from anon, authenticated;
revoke all on assets        from anon, authenticated;
revoke all on applications  from anon, authenticated;
revoke all on application_callbacks from anon, authenticated;
revoke all on audit_cache   from anon, authenticated;
revoke all on indexer_state from anon, authenticated;
revoke all on nonces        from anon, authenticated;
revoke all on authorization_codes from anon, authenticated;
