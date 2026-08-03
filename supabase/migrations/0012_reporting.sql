-- =============================================================================
-- Phase 12: Reports Engine
-- Introduces the `reporting` schema (the sixth top-level schema from the
-- original blueprint) with the cross-cutting views every report queries.
-- Every view is security_invoker so it inherits RLS from the base tables
-- it joins, exactly like accounting.v_voucher_register and
-- assets.v_asset_valuation from earlier phases — no separate RLS setup
-- needed on the views themselves.
-- =============================================================================

create schema if not exists reporting;

-- Cash Book / Bank Book need a way to identify which accounts are cash vs.
-- bank; nothing on chart_of_accounts distinguished that before now.
alter table accounting.chart_of_accounts
  add column is_cash boolean not null default false,
  add column is_bank boolean not null default false;

-- -----------------------------------------------------------------------------
-- General Ledger — backs the GL, Trial Balance, Balance Sheet, P&L, Cash
-- Book, and Bank Book reports (all of which are just different filters/
-- aggregations over the same posted-lines dataset). chart_of_accounts.
-- opening_balance is deliberately excluded — it's an informational display
-- field only; the real "opening balance" impact is whatever an actual
-- Opening Balance Voucher posted, which already flows through here.
-- -----------------------------------------------------------------------------

create or replace view reporting.v_ledger_entries as
select
  je.company_id,
  jel.journal_entry_id,
  jel.line_no,
  je.entry_date,
  jel.account_id,
  coa.account_code,
  coa.account_name,
  coa.account_type,
  coa.is_cash,
  coa.is_bank,
  jel.cost_center_id,
  je.voucher_type,
  je.voucher_id,
  vr.voucher_no,
  jel.base_debit_amount as debit_amount,
  jel.base_credit_amount as credit_amount,
  jel.description,
  je.narration,
  je.status
from accounting.journal_entry_lines jel
join accounting.journal_entries je on je.id = jel.journal_entry_id
join accounting.chart_of_accounts coa on coa.id = jel.account_id
left join accounting.v_voucher_register vr
  on vr.company_id = je.company_id and vr.voucher_type = je.voucher_type and vr.voucher_id = je.voucher_id
where je.status = 'posted';

alter view reporting.v_ledger_entries set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Asset Register
-- -----------------------------------------------------------------------------

create or replace view reporting.v_asset_register as
select
  a.id as asset_id, a.company_id, a.asset_code, a.asset_name, a.property_type,
  a.country, a.city, a.area, a.owner, a.status, a.purchase_date, a.purchase_value, a.current_value
from assets.assets a
where a.deleted_at is null;

alter view reporting.v_asset_register set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Purchase Report
-- -----------------------------------------------------------------------------

create or replace view reporting.v_purchase_report as
select
  pv.company_id, pv.id as purchase_voucher_id, pv.voucher_no, pv.purchase_date,
  a.asset_code, a.asset_name, s.name as supplier_name,
  pv.purchase_price, pv.taxes, pv.registration_charges, pv.additional_expenses, pv.total_amount,
  cur.code as currency_code, je.status
from accounting.purchase_vouchers pv
join assets.assets a on a.id = pv.asset_id
join assets.suppliers s on s.id = pv.supplier_id
join core.currencies cur on cur.id = pv.currency_id
join accounting.journal_entries je on je.id = pv.journal_entry_id;

alter view reporting.v_purchase_report set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Sale Report
-- -----------------------------------------------------------------------------

create or replace view reporting.v_sale_report as
select
  s.company_id, s.id as sale_id, s.voucher_no, s.sale_date, s.buyer,
  a.asset_code, a.asset_name,
  s.sale_price, s.book_value_at_sale, s.profit_loss_amount,
  s.purchase_value_at_sale, s.capital_gain_amount,
  cur.code as currency_code, je.status
from assets.asset_sales s
join assets.assets a on a.id = s.asset_id
join core.currencies cur on cur.id = s.currency_id
join accounting.journal_entries je on je.id = s.journal_entry_id;

alter view reporting.v_sale_report set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Rental Income (UAE + Pakistan union) — posted invoices only, since this
-- reports recognized income rather than draft/pending activity.
-- -----------------------------------------------------------------------------

create or replace view reporting.v_rental_income as
select
  uri.company_id, 'UAE'::text as country, uri.id as invoice_id, uri.voucher_no,
  a.asset_code, a.asset_name, t.name as tenant_name,
  uri.invoice_date, uri.due_date, uri.amount, uri.outstanding_balance,
  cur.code as currency_code, je.status
from rental.uae_rent_invoices uri
join rental.uae_leases ul on ul.id = uri.lease_id
join assets.assets a on a.id = ul.asset_id
join rental.tenants t on t.id = ul.tenant_id
join core.currencies cur on cur.id = uri.currency_id
join accounting.journal_entries je on je.id = uri.journal_entry_id
where je.status = 'posted'
union all
select
  pri.company_id, 'PK'::text as country, pri.id as invoice_id, pri.voucher_no,
  a.asset_code, a.asset_name, t.name as tenant_name,
  pri.invoice_date, pri.due_date, pri.total_amount as amount, pri.outstanding_amount as outstanding_balance,
  cur.code as currency_code, je.status
from rental.pk_rent_invoices pri
join rental.pk_leases pl on pl.id = pri.lease_id
join assets.assets a on a.id = pl.asset_id
join rental.tenants t on t.id = pl.tenant_id
join core.currencies cur on cur.id = pri.currency_id
join accounting.journal_entries je on je.id = pri.journal_entry_id
where je.status = 'posted';

alter view reporting.v_rental_income set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Outstanding Rent — posted invoices (via v_rental_income) with a balance
-- still due, plus how many days past due.
-- -----------------------------------------------------------------------------

create or replace view reporting.v_outstanding_rent as
select *, (current_date - due_date) as days_overdue
from reporting.v_rental_income
where outstanding_balance > 0;

alter view reporting.v_outstanding_rent set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Currency Exchange History
-- -----------------------------------------------------------------------------

create or replace view reporting.v_currency_exchange_history as
select
  er.company_id, cur.code as currency_code, cur.name as currency_name,
  er.rate_date, er.rate_to_base, er.source, er.created_by, er.created_at
from core.exchange_rates er
join core.currencies cur on cur.id = er.currency_id;

alter view reporting.v_currency_exchange_history set (security_invoker = on);
