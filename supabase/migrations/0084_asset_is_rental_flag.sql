-- Rental flag on properties. A property (asset) is registered from Chart of
-- Accounts under the PROPERTIES group regardless of this flag; only properties
-- with is_rental = true are offered in the lease dropdowns (filtered by country:
-- AE → UAE/HH leases, PK → PK leases). Controlled by the "This is a rental
-- property" checkbox on the CoA account form.

alter table assets.assets
  add column if not exists is_rental boolean not null default false;

-- Preserve current behaviour: every existing asset already appeared in the lease
-- dropdowns, so mark them all rental. New properties default to false and are
-- flagged explicitly from the CoA checkbox.
update assets.assets set is_rental = true where is_rental = false;
