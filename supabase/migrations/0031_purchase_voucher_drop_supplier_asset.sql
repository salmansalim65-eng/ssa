-- =============================================================================
-- Purchase Voucher: drop the Supplier (header) and per-line Asset. The voucher
-- is now purely account-driven (Vendor account credited, Fixed Asset accounts
-- debited). Make the columns nullable rather than removing them so any prior
-- data is preserved, and rebuild v_purchase_report to key off the line's
-- account instead of an asset/supplier.
-- =============================================================================

alter table accounting.purchase_vouchers alter column supplier_id drop not null;
alter table accounting.purchase_voucher_lines alter column asset_id drop not null;

drop view if exists reporting.v_purchase_report;

create view reporting.v_purchase_report as
select pv.company_id,
       pv.id as purchase_voucher_id,
       pv.voucher_no,
       pv.purchase_date,
       fa.account_name,
       l.gross,
       cur.code as currency_code,
       je.status
from accounting.purchase_vouchers pv
  join accounting.purchase_voucher_lines l on l.voucher_id = pv.id
  join accounting.chart_of_accounts fa on fa.id = l.fixed_asset_account_id
  join core.currencies cur on cur.id = pv.currency_id
  join accounting.journal_entries je on je.id = pv.journal_entry_id;

alter view reporting.v_purchase_report set (security_invoker = on);
grant select on reporting.v_purchase_report to authenticated, service_role;
