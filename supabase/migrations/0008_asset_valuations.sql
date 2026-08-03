-- =============================================================================
-- Phase 8: Asset Current Value
-- Historical market valuations per asset. Reporting-only: nothing here
-- touches accounting.journal_entries or any GL balance. The one side
-- effect allowed is keeping assets.assets.current_value in sync with the
-- latest valuation, since that's just a display convenience, not a
-- financial posting.
-- =============================================================================

create table assets.asset_valuations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  asset_id         uuid not null references assets.assets(id) on delete cascade,
  valuation_date   date not null,
  market_value     numeric(18,2) not null check (market_value >= 0),
  valuer           text,
  notes            text,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz,
  deleted_by       uuid references auth.users(id),
  deleted_at       timestamptz
);

create index idx_asset_valuations_asset on assets.asset_valuations(asset_id, valuation_date desc);

create trigger trg_asset_valuations_touch
  before update on assets.asset_valuations
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_asset_valuations after insert or update or delete on assets.asset_valuations
  for each row execute function audit.fn_row_audit();

-- Keeps assets.assets.current_value showing the most recent valuation
-- (by valuation_date, not insertion order, so a backdated entry doesn't
-- incorrectly override a later one). Purely informational.
create or replace function assets.fn_sync_current_value_from_valuation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_id uuid := coalesce(new.asset_id, old.asset_id);
  v_latest_value numeric(18,2);
begin
  select market_value into v_latest_value
  from assets.asset_valuations
  where asset_id = v_asset_id and deleted_at is null
  order by valuation_date desc, created_at desc
  limit 1;

  if v_latest_value is not null then
    update assets.assets set current_value = v_latest_value where id = v_asset_id;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger trg_sync_current_value_from_valuation
  after insert or update or delete on assets.asset_valuations
  for each row execute function assets.fn_sync_current_value_from_valuation();

alter table assets.asset_valuations enable row level security;

create policy asset_valuations_select on assets.asset_valuations
  for select using (company_id = core.current_company_id() and deleted_at is null);
create policy asset_valuations_insert on assets.asset_valuations
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('asset_valuations', 'create'));
create policy asset_valuations_update on assets.asset_valuations
  for update using (company_id = core.current_company_id() and core.user_has_permission('asset_valuations', 'edit'));
create policy asset_valuations_delete on assets.asset_valuations
  for update using (company_id = core.current_company_id() and core.user_has_permission('asset_valuations', 'delete'));

-- -----------------------------------------------------------------------------
-- Asset Valuation Report
-- -----------------------------------------------------------------------------

create or replace view assets.v_asset_valuation as
select a.id as asset_id, a.company_id, a.asset_code, a.asset_name, a.property_type,
       a.country, a.city, a.purchase_value, a.current_value,
       (a.current_value - a.purchase_value) as variance,
       latest.valuation_date as latest_valuation_date,
       latest.valuer as latest_valuer
from assets.assets a
left join lateral (
  select valuation_date, valuer
  from assets.asset_valuations v
  where v.asset_id = a.id and v.deleted_at is null
  order by v.valuation_date desc, v.created_at desc
  limit 1
) latest on true
where a.deleted_at is null;

comment on view assets.v_asset_valuation is
  'Backs the Asset Valuation Report: one row per asset with its latest valuation. security_invoker below means it inherits RLS from assets.assets.';

alter view assets.v_asset_valuation set (security_invoker = on);
