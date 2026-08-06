-- =============================================================================
-- Migration 0020 added six asset fields, but they never landed on the deployed
-- database (0020 was only partially applied — the same reason 0022 had to
-- re-assert fn_next_master_code). Creating an asset failed with
-- "Could not find the 'area_sqft' column of 'assets' in the schema cache".
-- Re-assert the columns idempotently so the DB matches the app + types.
-- =============================================================================

alter table assets.assets
  add column if not exists area_sqft numeric(18,2),
  add column if not exists service_charges_rate numeric(18,2),
  add column if not exists title_deed_value numeric(18,2),
  add column if not exists estimated_rent numeric(18,2),
  add column if not exists currency_id uuid references core.currencies(id),
  add column if not exists group_cost_center_id uuid references accounting.cost_centers(id) on delete set null;
