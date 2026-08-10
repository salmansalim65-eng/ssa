-- Asset cost-center is now user-controlled instead of always auto-created.
--   * 'new'      -> auto-create a dedicated cost center for the asset (the prior
--                   always-on behavior).
--   * 'none'     -> no cost center at all.
--   * 'existing' -> link the asset to an existing cost center via
--                   group_cost_center_id (no new cost center is created).
-- Default is 'new' so any path that doesn't set it keeps the old behavior.
alter table assets.assets
  add column if not exists cost_center_mode text not null default 'new'
    check (cost_center_mode in ('new', 'none', 'existing'));

-- Only auto-create the dedicated cost center when the asset asked for 'new'.
create or replace function assets.fn_create_cost_center_for_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cost_center_mode = 'new' then
    insert into accounting.cost_centers (company_id, code, name, asset_id, country, city, property_type, owner, created_by)
    values (new.company_id, new.asset_code, new.asset_name, new.id, new.country, new.city, new.property_type, new.owner, new.created_by);
  end if;
  return new;
end;
$$;
