-- Two-way sync between an asset and its linked cost center.
--
-- Background: 0006 auto-creates a cost center per asset and pushes asset edits
-- to it (asset -> cost_center). This adds the reverse direction so editing the
-- cost center's mirrored fields (code / name / location / owner) flows back to
-- the asset (cost_center -> asset).
--
-- Loop prevention: each direction updates the target ONLY when a mirrored value
-- actually differs. After the first hop the two rows are equal, so the echoing
-- UPDATE matches zero rows, its AFTER-UPDATE trigger fires against an unchanged
-- target, and the cascade stops after exactly one bounce. This is a single-
-- statement guard (no session GUC / depth counter needed).
--
-- Note: only Asset <-> Cost Center are linked in the schema; no chart-of-
-- accounts row is tied to an asset, so the Chart of Accounts is intentionally
-- not part of this sync.

-- Forward direction (asset -> cost_center), now guarded so the reverse echo
-- resolves to a no-op instead of re-triggering.
create or replace function assets.fn_sync_cost_center_from_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update accounting.cost_centers cc
  set code = new.asset_code,
      name = new.asset_name,
      country = new.country,
      city = new.city,
      property_type = new.property_type,
      owner = new.owner,
      updated_by = auth.uid(),
      updated_at = now()
  where cc.asset_id = new.id
    and (cc.code is distinct from new.asset_code
      or cc.name is distinct from new.asset_name
      or cc.country is distinct from new.country
      or cc.city is distinct from new.city
      or cc.property_type is distinct from new.property_type
      or cc.owner is distinct from new.owner);
  return new;
end;
$$;

-- Reverse direction (cost_center -> asset).
create or replace function accounting.fn_sync_asset_from_cost_center()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.asset_id is null then
    return new;
  end if;

  update assets.assets a
  set asset_code = new.code,
      asset_name = new.name,
      country = new.country,
      city = new.city,
      property_type = new.property_type,
      owner = new.owner,
      updated_by = auth.uid(),
      updated_at = now()
  where a.id = new.asset_id
    and (a.asset_code is distinct from new.code
      or a.asset_name is distinct from new.name
      or a.country is distinct from new.country
      or a.city is distinct from new.city
      or a.property_type is distinct from new.property_type
      or a.owner is distinct from new.owner);
  return new;
end;
$$;

drop trigger if exists trg_sync_asset_from_cost_center on accounting.cost_centers;
create trigger trg_sync_asset_from_cost_center
  after update of code, name, country, city, property_type, owner on accounting.cost_centers
  for each row execute function accounting.fn_sync_asset_from_cost_center();

comment on trigger trg_sync_asset_from_cost_center on accounting.cost_centers is
  'Mirrors a linked cost center''s code/name/location/owner edits back onto its asset. Pairs with trg_sync_cost_center_from_asset; both only write when a value differs, so the two-way sync settles after one hop with no loop.';
