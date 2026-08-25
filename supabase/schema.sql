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
-- Ownership is NOT stored here. Ownership comes from AssetNFT.ownerOf().
-- ───────────────────────────────────────────────────────────────────────
create table if not exists assets (
  id                uuid primary key default gen_random_uuid(),
  token_id          bigint unique,        -- null until minted and confirmed
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

comment on column assets.asset_hash is
  'keccak256 of the confidential record. Must match AssetNFT.getAsset().assetHash.';
comment on column assets.token_id is
  'Null while the asset is a draft. Set only after the mint is verified on-chain.';

-- ───────────────────────────────────────────────────────────────────────
-- applications — Web2 apps that authenticate through OwneX
-- appId on-chain is keccak256(slug); the slug and display detail live here.
-- ───────────────────────────────────────────────────────────────────────
create table if not exists applications (
  org_id       bigint not null references organizations (org_id) on delete cascade,
  app_slug     text not null,             -- e.g. 'employee-portal'
  app_id       text not null,             -- keccak256(app_slug), the on-chain key
  name         text not null,
  url          text not null,
  description  text,
  logo_url     text,
  created_at   timestamptz not null default now(),
  primary key (org_id, app_slug)
);

create index if not exists applications_app_id_idx on applications (app_id);

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

comment on table nonces is
  'A nonce is valid only if unused and unexpired. Consumed atomically on verify.';

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

-- ═══════════════════════════════════════════════════════════════════════
-- Row Level Security — on everywhere, permissive policies nowhere.
-- Only the service role key (server side) can read or write.
-- ═══════════════════════════════════════════════════════════════════════
alter table profiles       enable row level security;
alter table organizations  enable row level security;
alter table assets         enable row level security;
alter table applications   enable row level security;
alter table audit_cache    enable row level security;
alter table indexer_state  enable row level security;
alter table nonces         enable row level security;

-- Belt and braces: revoke the default grants Supabase hands to anon.
revoke all on profiles      from anon, authenticated;
revoke all on organizations from anon, authenticated;
revoke all on assets        from anon, authenticated;
revoke all on applications  from anon, authenticated;
revoke all on audit_cache   from anon, authenticated;
revoke all on indexer_state from anon, authenticated;
revoke all on nonces        from anon, authenticated;
