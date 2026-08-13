-- Registering a property from Chart of Accounts inserts a row into
-- assets.assets. The BEFORE INSERT trigger trg_link_asset_account (migration
-- 0025) then auto-creates a *second* GL account under the "ASSETS" group for
-- that asset whenever the asset has no account_id — producing a duplicate,
-- same-named account alongside the real property account under "PROPERTIES".
-- The application now passes the property account's id as the asset's
-- account_id so the trigger no longer fires, but existing data already carries
-- these stray duplicates. This migration heals them.
--
-- A stray is: a non-group asset account directly under the "ASSETS" group,
-- with no linked_asset_id, no journal-entry lines, whose name matches a
-- property account (under "PROPERTIES", carrying linked_asset_id). We repoint
-- the asset to its real property account, then soft-delete the stray.

-- 1) Repoint each asset whose account_id points at a stray to its property account.
update assets.assets a
set account_id = prop.id
from accounting.chart_of_accounts prop
join accounting.chart_of_accounts pp
  on pp.id = prop.parent_id and upper(pp.account_name) = 'PROPERTIES'
where prop.deleted_at is null
  and prop.linked_asset_id = a.id
  and a.account_id is distinct from prop.id
  and exists (
    select 1
    from accounting.chart_of_accounts s
    join accounting.chart_of_accounts sp
      on sp.id = s.parent_id and upper(sp.account_name) = 'ASSETS'
    where s.id = a.account_id
      and s.deleted_at is null
      and lower(trim(s.account_name)) = lower(trim(prop.account_name))
  );

-- 2) Soft-delete the stray duplicate asset GL accounts (nothing references them now).
update accounting.chart_of_accounts s
set deleted_at = now()
from accounting.chart_of_accounts sp
where sp.id = s.parent_id
  and upper(sp.account_name) = 'ASSETS'
  and s.deleted_at is null
  and s.is_group = false
  and s.linked_asset_id is null
  and not exists (select 1 from accounting.journal_entry_lines l where l.account_id = s.id)
  and not exists (select 1 from assets.assets a where a.account_id = s.id and a.deleted_at is null)
  and exists (
    select 1
    from accounting.chart_of_accounts prop
    join accounting.chart_of_accounts pp
      on pp.id = prop.parent_id and upper(pp.account_name) = 'PROPERTIES'
    where prop.company_id = s.company_id
      and prop.deleted_at is null
      and prop.linked_asset_id is not null
      and lower(trim(prop.account_name)) = lower(trim(s.account_name))
  );
