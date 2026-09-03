-- ═══════════════════════════════════════════════════════════════════════
-- OwneX — 0002_asset_deployment_scope
--
-- Scopes an asset's token binding to the AssetNFT deployment it came from.
--
-- Run after supabase/schema.sql and 0001, or:
--   psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_asset_deployment_scope.sql
--
-- WHY
--   `assets.token_id` was globally unique. A token id is not globally unique: it
--   is unique within one contract on one chain, and AssetNFT starts counting at 1
--   again every time it is deployed. After a redeploy, rows still holding ids
--   from the previous contract collide with the new mints that legitimately own
--   those ids, and the mint confirm step fails with
--
--     duplicate key value violates unique constraint "assets_token_id_key"
--
--   which leaves a real, paid-for token on-chain with no record bound to it.
--
-- WHAT IT CHANGES
--   assets.chain_id           the chain the binding belongs to
--   assets.contract_address   the AssetNFT that issued the token
--   uniqueness                (contract_address, token_id) instead of token_id
--
-- The migration is idempotent. It does not guess which deployment existing rows
-- came from — that needs the chain, so `npm run repair:assets` stamps rows it has
-- verified and releases the ones the chain contradicts.
-- ═══════════════════════════════════════════════════════════════════════

alter table assets add column if not exists chain_id bigint;
alter table assets add column if not exists contract_address text;

-- Addresses are stored lowercase here, as everywhere else in this schema, so
-- comparison is a plain string equality rather than a case-folding function.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assets_contract_address_format_check'
  ) then
    alter table assets add constraint assets_contract_address_format_check
      check (contract_address is null or contract_address ~ '^0x[0-9a-f]{40}$');
  end if;
end;
$$;

-- The old global uniqueness has to go: it is the constraint that breaks minting
-- after a redeploy. It may exist as a constraint or as a bare index depending on
-- how the table was created, so both are dropped.
alter table assets drop constraint if exists assets_token_id_key;
drop index if exists assets_token_id_key;

-- Uniqueness that reflects reality: one row per token per deployment.
--
-- `coalesce` matters. A plain unique index treats NULLs as distinct, so rows that
-- predate this migration — which have no contract_address yet — would be allowed
-- to double up on a token id and the guard would quietly do nothing for exactly
-- the rows most likely to be stale.
create unique index if not exists assets_token_per_deployment_key
  on assets (coalesce(contract_address, 'unstamped'), token_id)
  where token_id is not null;

create index if not exists assets_deployment_idx
  on assets (contract_address, org_id);

comment on column assets.contract_address is
  'The AssetNFT that issued token_id, lowercase. Null on rows that predate deployment scoping.';
comment on column assets.chain_id is
  'The chain the binding belongs to. Together with contract_address it makes token_id meaningful.';
comment on column assets.token_id is
  'Null while the asset is a draft. Set only after the mint is verified on-chain, and unique per (contract_address, token_id).';
