-- The ledger view exposes only base-currency amounts (base_debit/base_credit).
-- The dashboard now shows each country's balances in that country's own currency
-- (UAE in AED, Pakistan in PKR), so expose the document-currency amounts and the
-- line currency code as well. Additive (new columns appended at the end) and
-- security_invoker, so existing report queries that select the base columns are
-- unaffected.
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
  cc.country as cost_center_country,
  jel.debit_amount as doc_debit_amount,
  jel.credit_amount as doc_credit_amount,
  cur.code as currency_code
from accounting.journal_entry_lines jel
  join accounting.journal_entries je on je.id = jel.journal_entry_id
  join accounting.chart_of_accounts coa on coa.id = jel.account_id
  left join accounting.cost_centers cc on cc.id = jel.cost_center_id
  left join core.currencies cur on cur.id = jel.currency_id
  left join accounting.v_voucher_register vr
    on vr.company_id = je.company_id and vr.voucher_type = je.voucher_type and vr.voucher_id = je.voucher_id
  left join rental.uae_rent_invoices uri on uri.journal_entry_id = je.id
  left join rental.pk_rent_invoices pri on pri.journal_entry_id = je.id
  left join accounting.purchase_vouchers purv on purv.journal_entry_id = je.id
where je.status = 'posted'::text;

alter view reporting.v_ledger_entries set (security_invoker = on);
