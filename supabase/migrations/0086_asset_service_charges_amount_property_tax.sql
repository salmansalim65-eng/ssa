-- Service Charges Amount (UAE/HH) and Property Tax (PK) on assets.
--   service_charges_amount = service_charges_rate * area_sqft (auto-computed).
--   property_tax is entered manually for Pakistan properties.
-- The JV Service Charges voucher auto-fills a line's amount from these when a
-- cost centre / asset is selected (service charges for AE assets, property tax
-- for PK assets).

alter table assets.assets
  add column if not exists property_tax numeric(18, 2) not null default 0;

alter table assets.assets
  add column if not exists service_charges_amount numeric(18, 2)
    generated always as (coalesce(service_charges_rate, 0) * coalesce(area_sqft, 0)) stored;
