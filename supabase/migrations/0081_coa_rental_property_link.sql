-- Chart-of-Accounts → Assets link for the "This is a rental property" toggle.
--
-- Leases (UAE / PK / HH) read their selectable properties from assets.assets,
-- filtered by country — NOT from the Chart of Accounts. A property entered only
-- as a CoA asset account therefore never appears in a lease.
--
-- This column lets a posting asset account be flagged as a rental property: the
-- app auto-creates a matching assets.assets row (which in turn auto-creates its
-- cost centre) and stores the asset id here. Once linked, the account is kept in
-- step with its property, and the property is immediately selectable in leases.
--
-- The FK is ON DELETE SET NULL so deleting the underlying asset never blocks the
-- account — the account simply loses its property link.
alter table accounting.chart_of_accounts
  add column if not exists linked_asset_id uuid
    references assets.assets(id) on delete set null;

create index if not exists idx_coa_linked_asset
  on accounting.chart_of_accounts(linked_asset_id)
  where linked_asset_id is not null;

comment on column accounting.chart_of_accounts.linked_asset_id is
  'When set, this posting asset account is a rental property linked to the given assets.assets row (created via the "This is a rental property" toggle). Because leases read assets from assets.assets, linking makes the property selectable in UAE/PK/HH lease forms for its country.';
