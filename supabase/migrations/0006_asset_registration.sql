-- =============================================================================
-- Phase 6: Asset Registration
-- Registers rental properties and other assets. Every asset automatically
-- gets a matching accounting.cost_centers row (Phase 3 left cost_centers
-- .asset_id unconstrained for exactly this migration to fill in).
-- =============================================================================

create schema if not exists assets;

create table assets.assets (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references core.companies(id) on delete cascade,
  asset_code                text not null,
  asset_name                text not null,
  property_type             text not null,
  country                   text not null check (country in ('PK','AE')),
  city                      text,
  area                      text,
  address                   text,
  purchase_date             date,
  purchase_value            numeric(18,2),
  current_value             numeric(18,2),
  status                    text not null default 'active' check (status in ('active','sold','inactive')),
  owner                     text,
  title_deed_attachment_id  uuid references core.attachments(id) on delete set null,
  notes                     text,
  created_by                uuid not null references auth.users(id),
  created_at                timestamptz not null default now(),
  updated_by                uuid references auth.users(id),
  updated_at                timestamptz,
  deleted_by                uuid references auth.users(id),
  deleted_at                timestamptz,
  constraint assets_code_unique unique (company_id, asset_code)
);

create index idx_assets_company on assets.assets(company_id);

create trigger trg_assets_touch
  before update on assets.assets
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_assets after insert or update or delete on assets.assets
  for each row execute function audit.fn_row_audit();

-- Phase 3 created cost_centers.asset_id with no FK since assets.assets
-- didn't exist yet. Wire it up now.
alter table accounting.cost_centers
  add constraint cost_centers_asset_id_fkey foreign key (asset_id) references assets.assets(id) on delete set null;

-- Every registered asset gets exactly one cost center, auto-created —
-- this is the "Each Cost Center represents one registered asset" rule from
-- the spec, enforced structurally rather than left to manual data entry.
create or replace function assets.fn_create_cost_center_for_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into accounting.cost_centers (company_id, code, name, asset_id, country, city, property_type, owner, created_by)
  values (new.company_id, new.asset_code, new.asset_name, new.id, new.country, new.city, new.property_type, new.owner, new.created_by);
  return new;
end;
$$;

create trigger trg_create_cost_center_for_asset
  after insert on assets.assets
  for each row execute function assets.fn_create_cost_center_for_asset();

comment on trigger trg_create_cost_center_for_asset on assets.assets is
  'Auto-creates the matching accounting.cost_centers row. If the asset_code collides with an existing manually-created cost center code, this raises the underlying unique_violation — the asset insert fails and the user renames the code.';

-- Keep the cost center's descriptive fields in sync when the asset changes
-- (code/name/location fields the cost center mirrors).
create or replace function assets.fn_sync_cost_center_from_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update accounting.cost_centers
  set code = new.asset_code,
      name = new.asset_name,
      country = new.country,
      city = new.city,
      property_type = new.property_type,
      owner = new.owner,
      updated_by = auth.uid(),
      updated_at = now()
  where asset_id = new.id;
  return new;
end;
$$;

create trigger trg_sync_cost_center_from_asset
  after update of asset_code, asset_name, country, city, property_type, owner on assets.assets
  for each row execute function assets.fn_sync_cost_center_from_asset();

create table assets.asset_images (
  id             uuid primary key default gen_random_uuid(),
  asset_id       uuid not null references assets.assets(id) on delete cascade,
  attachment_id  uuid not null references core.attachments(id) on delete cascade,
  is_primary     boolean not null default false,
  created_at     timestamptz not null default now(),
  constraint asset_images_unique unique (asset_id, attachment_id)
);

create unique index idx_asset_images_one_primary on assets.asset_images(asset_id) where is_primary;
create index idx_asset_images_asset on assets.asset_images(asset_id);

create trigger trg_audit_asset_images after insert or update or delete on assets.asset_images
  for each row execute function audit.fn_row_audit();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table assets.assets enable row level security;
alter table assets.asset_images enable row level security;

create policy assets_select on assets.assets
  for select using (company_id = core.current_company_id() and deleted_at is null);
create policy assets_insert on assets.assets
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('assets', 'create'));
create policy assets_update on assets.assets
  for update using (company_id = core.current_company_id() and core.user_has_permission('assets', 'edit'));
create policy assets_delete on assets.assets
  for update using (company_id = core.current_company_id() and core.user_has_permission('assets', 'delete'));

create policy asset_images_select on assets.asset_images
  for select using (
    exists (select 1 from assets.assets a where a.id = asset_id and a.company_id = core.current_company_id())
  );
create policy asset_images_write on assets.asset_images
  for all using (
    core.user_has_permission('assets', 'edit')
    and exists (select 1 from assets.assets a where a.id = asset_id and a.company_id = core.current_company_id())
  ) with check (
    core.user_has_permission('assets', 'edit')
    and exists (select 1 from assets.assets a where a.id = asset_id and a.company_id = core.current_company_id())
  );
