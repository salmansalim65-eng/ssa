-- =============================================================================
-- Asset / Property module enhancements
--   1. core.countries         — per-company country master (custom countries)
--   2. assets.assets          — official_owner, area_unit, other_charges, and a
--                               generated total_property_value column
--   3. assets.asset_value_history — audit log of Current Value changes
--   4. permissions catalog    — countries + asset_value_history modules
--   5. value-history plumbing — logging RPC, recompute + delete RPCs, and a
--                               valuation-sync trigger that also records history
--
-- Nothing here touches accounting: current_value / total_property_value are
-- informational display fields only and are not referenced by the GL,
-- depreciation, or asset-sale calculations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Country master (per company). asset.country keeps storing the code text
--    (e.g. 'AE','PK') so the rental module — which filters assets by
--    country = 'AE' / 'PK' — keeps working unchanged. The master only backs the
--    picker and the "+ Add country" flow.
-- -----------------------------------------------------------------------------

create table core.countries (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  code        text not null,
  name        text not null,
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz,
  constraint countries_company_code_unique unique (company_id, code)
);

create unique index idx_countries_company_name on core.countries (company_id, lower(name));
create index idx_countries_company on core.countries (company_id);

create trigger trg_countries_touch
  before update on core.countries
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_countries after insert or update or delete on core.countries
  for each row execute function audit.fn_row_audit();

alter table core.countries enable row level security;

create policy countries_select on core.countries
  for select using (company_id = core.current_company_id());
create policy countries_insert on core.countries
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('countries', 'create'));
create policy countries_update on core.countries
  for update using (company_id = core.current_company_id() and core.user_has_permission('countries', 'edit'));

-- Seed the two standard countries for every company.
insert into core.countries (company_id, code, name)
select c.id, x.code, x.name
from core.companies c
cross join (values ('AE', 'United Arab Emirates'), ('PK', 'Pakistan')) as x(code, name)
on conflict (company_id, code) do nothing;

-- Preserve any country codes already used by existing assets (name = code when
-- we have nothing better) so those assets stay selectable.
insert into core.countries (company_id, code, name)
select distinct a.company_id, a.country, a.country
from assets.assets a
where a.country is not null and a.country <> ''
on conflict (company_id, code) do nothing;

-- -----------------------------------------------------------------------------
-- 2. New asset columns + generated total.
--    Total Property Value = Current + Title Deed + Service Charges + Other.
--    Blank fields count as 0 (coalesce). STORED generated column so it is
--    always accurate and can be queried / sorted directly.
-- -----------------------------------------------------------------------------

alter table assets.assets
  add column official_owner text,
  add column area_unit text,
  add column other_charges numeric(18,2),
  add column total_property_value numeric(18,2) generated always as (
    coalesce(current_value, 0)
    + coalesce(title_deed_value, 0)
    + coalesce(service_charges_rate, 0)
    + coalesce(other_charges, 0)
  ) stored;

-- -----------------------------------------------------------------------------
-- 3. Current Value history (audit log). Hard rows (no soft-delete) — deletion is
--    gated by the asset_value_history:delete permission via an RPC below.
-- -----------------------------------------------------------------------------

create table assets.asset_value_history (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references core.companies(id) on delete cascade,
  asset_id       uuid not null references assets.assets(id) on delete cascade,
  effective_date date not null,
  previous_value numeric(18,2),
  new_value      numeric(18,2) not null,
  changed_by     uuid references auth.users(id),
  remarks        text,
  created_at     timestamptz not null default now()
);

create index idx_asset_value_history_asset
  on assets.asset_value_history (asset_id, effective_date desc, created_at desc);

create trigger trg_audit_asset_value_history after insert or update or delete on assets.asset_value_history
  for each row execute function audit.fn_row_audit();

alter table assets.asset_value_history enable row level security;

-- Read: anyone who can see the company. Inserts happen via SECURITY DEFINER RPCs
-- (below) so no client INSERT policy is needed (RLS default-denies direct
-- inserts). Update/delete go through RPCs too, but a permission-gated update
-- policy is provided for completeness.
create policy asset_value_history_select on assets.asset_value_history
  for select using (company_id = core.current_company_id());
create policy asset_value_history_update on assets.asset_value_history
  for update using (company_id = core.current_company_id() and core.user_has_permission('asset_value_history', 'edit'));

-- Seed one starting record per existing asset that has a current value. No
-- historical data is invented — this is just the current value as the baseline.
insert into assets.asset_value_history (company_id, asset_id, effective_date, previous_value, new_value, changed_by, remarks)
select a.company_id, a.id, coalesce(a.purchase_date, a.created_at::date), null, a.current_value, a.created_by, 'Initial value (migrated)'
from assets.assets a
where a.current_value is not null and a.deleted_at is null;

-- -----------------------------------------------------------------------------
-- 4. Permission catalog entries. Admins bypass permission checks, so no
--    role_permissions seeding is required — these rows just make the modules
--    appear in the permission-matrix UI and allow granular grants.
-- -----------------------------------------------------------------------------

insert into core.permissions (module_key, action, label) values
  ('countries', 'create', 'Create countries'),
  ('countries', 'edit', 'Edit countries'),
  ('asset_value_history', 'edit', 'Edit asset value history'),
  ('asset_value_history', 'delete', 'Delete asset value history')
on conflict (module_key, action) do nothing;

-- -----------------------------------------------------------------------------
-- 5a. Log a Current Value change. Called from the create/update asset actions.
-- -----------------------------------------------------------------------------

create or replace function assets.fn_log_value_change(
  p_asset_id uuid,
  p_previous numeric,
  p_new numeric,
  p_effective_date date,
  p_remarks text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
begin
  select company_id into v_company from assets.assets where id = p_asset_id;
  if v_company is null then
    raise exception 'Asset not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not (core.user_has_permission('assets', 'edit') or core.user_has_permission('assets', 'create')) then
    raise exception 'Not authorized to change asset value';
  end if;

  insert into assets.asset_value_history
    (company_id, asset_id, effective_date, previous_value, new_value, changed_by, remarks)
  values
    (v_company, p_asset_id, coalesce(p_effective_date, current_date), p_previous, p_new, auth.uid(), nullif(p_remarks, ''));
end;
$function$;

grant execute on function assets.fn_log_value_change(uuid, numeric, numeric, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5b. Recompute current_value from the latest-effective history row. Keeps the
--     denormalised current_value consistent after a history row is deleted.
-- -----------------------------------------------------------------------------

create or replace function assets.fn_recompute_current_value(p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_value numeric(18,2);
  v_found boolean;
begin
  select new_value into v_value
  from assets.asset_value_history
  where asset_id = p_asset_id
  order by effective_date desc, created_at desc
  limit 1;
  v_found := found;

  -- Only overwrite when there is still history to derive from; if every record
  -- was removed, leave the last known current_value untouched.
  if v_found then
    update assets.assets set current_value = v_value where id = p_asset_id;
  end if;
end;
$function$;

grant execute on function assets.fn_recompute_current_value(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5c. Delete a history record (permission-gated) then recompute current_value.
-- -----------------------------------------------------------------------------

create or replace function assets.fn_delete_value_history(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_asset uuid;
begin
  select company_id, asset_id into v_company, v_asset
  from assets.asset_value_history where id = p_id;
  if v_company is null then
    raise exception 'Value history record not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('asset_value_history', 'delete') then
    raise exception 'Not authorized to delete value history';
  end if;

  delete from assets.asset_value_history where id = p_id;
  perform assets.fn_recompute_current_value(v_asset);
end;
$function$;

grant execute on function assets.fn_delete_value_history(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5d. Extend the existing valuation -> current_value sync so a valuation-driven
--     change is also captured in the Current Value history (keeps the history
--     complete regardless of which surface changed the value).
-- -----------------------------------------------------------------------------

create or replace function assets.fn_sync_current_value_from_valuation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_asset_id uuid := coalesce(new.asset_id, old.asset_id);
  v_latest_value numeric(18,2);
  v_latest_date date;
  v_old_value numeric(18,2);
  v_company uuid;
  v_valuer text;
begin
  select market_value, valuation_date, valuer
    into v_latest_value, v_latest_date, v_valuer
  from assets.asset_valuations
  where asset_id = v_asset_id and deleted_at is null
  order by valuation_date desc, created_at desc
  limit 1;

  if v_latest_value is not null then
    select current_value, company_id into v_old_value, v_company
    from assets.assets where id = v_asset_id;

    if v_old_value is distinct from v_latest_value then
      update assets.assets set current_value = v_latest_value where id = v_asset_id;

      insert into assets.asset_value_history
        (company_id, asset_id, effective_date, previous_value, new_value, changed_by, remarks)
      values
        (v_company, v_asset_id, coalesce(v_latest_date, current_date), v_old_value, v_latest_value,
         coalesce(auth.uid(), coalesce(new.created_by, old.created_by)),
         'From valuation' || case when v_valuer is not null and v_valuer <> '' then ' (' || v_valuer || ')' else '' end);
    end if;
  end if;

  return coalesce(new, old);
end;
$function$;
