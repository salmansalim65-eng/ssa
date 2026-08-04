-- =============================================================================
-- Every report page queries one of the views below (directly or via
-- lib/reports/cash-bank-book.ts) and nothing else in the app queries a view
-- at all -- every other section reads base tables. That the whole Reports
-- section fails uniformly while everything else works points at views
-- specifically not having picked up the SELECT grant that
-- 0016_grant_schema_privileges.sql issued via
-- `GRANT ... ON ALL TABLES IN SCHEMA ...` (which is documented to include
-- views, but is re-asserted here explicitly, per-view, as a direct fix
-- rather than relying on that assumption).
--
-- All of these are `security_invoker = on` views (see 0007, 0008, 0012), so
-- this SELECT grant is on top of -- not instead of -- the base-table grants
-- already in place; RLS on the underlying tables still applies to whichever
-- role queries the view.
-- =============================================================================

grant select on accounting.v_voucher_register to anon, authenticated, service_role;
grant select on assets.v_asset_valuation to anon, authenticated, service_role;

grant select on
  reporting.v_ledger_entries,
  reporting.v_asset_register,
  reporting.v_purchase_report,
  reporting.v_sale_report,
  reporting.v_rental_income,
  reporting.v_outstanding_rent,
  reporting.v_currency_exchange_history
to anon, authenticated, service_role;
