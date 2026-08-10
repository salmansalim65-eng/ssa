-- Expose the cost center's country on the ledger view so reports (P&L, Balance
-- Sheet, Trial Balance, Cash/Bank Book, General Ledger) can be filtered
-- country-wise. Country attribution flows: journal line -> cost_center_id ->
-- cost_centers.country (a country-master code such as 'AE' / 'PK'). Lines with no
-- cost center, or a cost center with no country, have a null cost_center_country
-- and therefore only appear under the "All countries" total.
--
-- The view stays security_invoker so it keeps inheriting RLS from its base
-- tables. All existing columns are preserved; cost_center_country is additive.

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
  je.status,
  coalesce(uri.due_date, pri.due_date, (
    select min(pvl.due_date) as min
    from accounting.purchase_voucher_lines pvl
    where pvl.voucher_id = purv.id
  )) as due_date,
  cc.country as cost_center_country
from accounting.journal_entry_lines jel
  join accounting.journal_entries je on je.id = jel.journal_entry_id
  join accounting.chart_of_accounts coa on coa.id = jel.account_id
  left join accounting.cost_centers cc on cc.id = jel.cost_center_id
  left join accounting.v_voucher_register vr
    on vr.company_id = je.company_id and vr.voucher_type = je.voucher_type and vr.voucher_id = je.voucher_id
  left join rental.uae_rent_invoices uri on uri.journal_entry_id = je.id
  left join rental.pk_rent_invoices pri on pri.journal_entry_id = je.id
  left join accounting.purchase_vouchers purv on purv.journal_entry_id = je.id
where je.status = 'posted'::text;

alter view reporting.v_ledger_entries set (security_invoker = on);
