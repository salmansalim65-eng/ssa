-- Assets originally hard-coded country to 'PK'/'AE' via a CHECK constraint. Now
-- that countries are managed in the per-company core.countries master and the
-- asset form only offers master countries (with inline "+ Add country"), this
-- constraint wrongly rejects any custom country (e.g. 'SA' Saudi Arabia) with
-- "new row for relation \"assets\" violates check constraint \"assets_country_check\"".
-- Drop it; validity is enforced at the application layer by the country picker.

alter table assets.assets drop constraint if exists assets_country_check;
