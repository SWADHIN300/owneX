-- ═══════════════════════════════════════════════════════════════════════
-- OwneX — 0001_generic_sso
--
-- Turns the Employee-Portal-specific SSO handoff into a generic
-- "Sign in with OwneX" authorization-code integration.
--
-- Run after supabase/schema.sql, or:
--   psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_generic_sso.sql
--
-- The migration is idempotent (every statement is IF NOT EXISTS / IF EXISTS
-- guarded) and preserves existing application rows, including the Employee
-- Portal seed.
--
-- WHAT IT ADDS
--   applications             client credentials, allowed roles, status
--   application_callbacks    the exact redirect URIs an application may use
--   authorization_codes      client id + org id, so a code is bound to one
--                            application rather than to a hard-coded slug
--
-- WHAT IT DELIBERATELY DOES NOT ADD
--   Nothing that decides who may sign in. Role access stays on-chain in
--   OrgAccessManager. This database holds integration configuration only.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ───────────────────────────────────────────────────────────────────────
-- 1. applications — integration configuration
-- ───────────────────────────────────────────────────────────────────────

alter table applications add column if not exists client_id text;
alter table applications add column if not exists client_secret_hash text;
alter table applications add column if not exists client_secret_updated_at timestamptz;
alter table applications add column if not exists allowed_roles text[] not null default '{}'::text[];
alter table applications add column if not exists updated_at timestamptz not null default now();

-- `status` needs care to stay idempotent.
--
-- Rows that predate this migration were live integrations and must stay usable, so
-- they need 'active'. Rows created AFTERWARDS start as 'draft' until an admin
-- registers them. A plain backfill (`update ... set status='active' where
-- status='draft'`) would satisfy the first requirement and break the second: run
-- the migration twice and every genuine draft an admin had not finished would be
-- silently activated.
--
-- Adding the column with 'active' as its default and then lowering the default to
-- 'draft' does both, and does it exactly once — on a re-run the column already
-- exists and this block does nothing at all.
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'applications'
       and column_name = 'status'
  ) then
    alter table applications add column status text not null default 'active';
    alter table applications alter column status set default 'draft';
  end if;
end $$;

comment on column applications.client_id is
  'Public client identifier presented by the partner application. Unguessable, but not a secret.';
comment on column applications.client_secret_hash is
  'scrypt digest of the client secret, format scrypt$N$r$p$salt$digest. The plaintext secret is shown once at generation and never stored.';
comment on column applications.allowed_roles is
  'Roles the admin INTENDED to grant. Advisory only — OrgAccessManager.canAccessApp is the authority.';
comment on column applications.status is
  'draft | active | revoked. A revoked integration is refused at /authorize and at code exchange without deleting audit history.';

-- A client id must identify exactly one application. Partial so rows that have
-- not been issued credentials yet do not collide on NULL.
create unique index if not exists applications_client_id_key
  on applications (client_id)
  where client_id is not null;

create index if not exists applications_status_idx on applications (status);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'applications_status_check'
  ) then
    alter table applications
      add constraint applications_status_check
      check (status in ('draft', 'active', 'revoked'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'applications_allowed_roles_check'
  ) then
    alter table applications
      add constraint applications_allowed_roles_check
      check (allowed_roles <@ array['ADMIN','MANAGER','AUDITOR','USER']::text[]);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'applications_client_id_format_check'
  ) then
    alter table applications
      add constraint applications_client_id_format_check
      check (client_id is null or client_id ~ '^ownex_[0-9a-f]{32}$');
  end if;
end $$;

-- Backfill: existing applications keep their data and gain a client id, so an
-- integration that already existed is not silently broken. No secret is
-- backfilled — an admin must generate one, which is the only way the plaintext
-- can be shown exactly once.
--
-- Idempotent: on a re-run every row already has a client id and nothing matches.
update applications
   set client_id = 'ownex_' || encode(gen_random_bytes(16), 'hex')
 where client_id is null;

drop trigger if exists applications_touch on applications;
create trigger applications_touch before update on applications
  for each row execute function touch_updated_at();

-- ───────────────────────────────────────────────────────────────────────
-- 2. application_callbacks — the exact redirect URIs, one row each
--
-- A table rather than a JSON column so the constraints are real: a callback
-- must look like an absolute http(s) URL, must be unique per application, and
-- disappears with the application. Exact-match lookup is an index hit.
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

  -- Absolute http(s), no whitespace, no query string, no fragment. The
  -- application layer applies the stricter rules (https outside localhost);
  -- this is the floor below which a row cannot exist at all.
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

comment on table application_callbacks is
  'Exact redirect URIs registered for an application. A redirect_uri is accepted only if it matches one of these after safe canonicalisation. No wildcards.';

-- Preserve the Employee Portal as the worked example: give it the callbacks it
-- already used, so the existing integration keeps functioning after migrating.
insert into application_callbacks (org_id, app_slug, callback_url)
select a.org_id, a.app_slug, c.url
  from applications a
  cross join (values
    ('http://localhost:3001/callback'),
    ('https://ownex-employee-portal.vercel.app/callback')
  ) as c(url)
 where a.app_slug = 'employee-portal'
on conflict (org_id, app_slug, callback_url) do nothing;

update applications
   set allowed_roles = array['ADMIN','MANAGER','AUDITOR','USER']::text[]
 where app_slug = 'employee-portal'
   and (allowed_roles is null or cardinality(allowed_roles) = 0);

-- ───────────────────────────────────────────────────────────────────────
-- 3. authorization_codes — generic, bound to a client
--
-- Codes live for two minutes and are single-use, so the rows here are always
-- transient. Any row predating this migration cannot be bound to a client id,
-- and an unbound code must never be redeemable — so they are removed before
-- the NOT NULL constraint is applied. Nothing durable is lost: a code older
-- than two minutes was already unusable.
-- ───────────────────────────────────────────────────────────────────────

alter table authorization_codes add column if not exists client_id text;
alter table authorization_codes add column if not exists org_id bigint;
alter table authorization_codes add column if not exists issued_at timestamptz not null default now();

delete from authorization_codes where client_id is null or org_id is null;

alter table authorization_codes alter column client_id set not null;
alter table authorization_codes alter column org_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'authorization_codes_wallet_check'
  ) then
    alter table authorization_codes
      add constraint authorization_codes_wallet_check
      check (wallet_address ~ '^0x[0-9a-f]{40}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'authorization_codes_redirect_check'
  ) then
    alter table authorization_codes
      add constraint authorization_codes_redirect_check
      check (redirect_uri ~ '^https?://[^\s]+$');
  end if;
end $$;

-- Lookup during exchange is by (code, client_id, redirect_uri) with used_at
-- null; `code` is already the primary key, and this index covers the pending
-- set an operator would want to inspect.
create index if not exists authorization_codes_pending_idx
  on authorization_codes (client_id, expires_at)
  where used_at is null;
create index if not exists authorization_codes_expiry_idx
  on authorization_codes (expires_at);
create index if not exists authorization_codes_wallet_idx
  on authorization_codes (wallet_address);

comment on table authorization_codes is
  'Single-use, 2-minute authorization codes. Consumed by a conditional UPDATE ... WHERE used_at IS NULL so a replay cannot succeed.';

-- Housekeeping, mirroring purge_expired_nonces.
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
-- 4. Row Level Security — on everywhere, permissive policies nowhere
-- ───────────────────────────────────────────────────────────────────────

alter table application_callbacks enable row level security;
revoke all on application_callbacks from anon, authenticated;
