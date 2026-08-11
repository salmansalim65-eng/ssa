-- The dashboard "Balances UAE" / "Balances PK" cards sum every posted ledger
-- line for the country. The business now wants those two cards to reflect only
-- operating balances, excluding three account groups: Cash & Bank, Fixed Assets
-- and Tenants. Cash/Bank already ship on the view (is_cash / is_bank); add two
-- more classification flags so the dashboard can filter those rows out:
--   * is_tenant_account     — a leaf account filed under a group marked
--                             is_tenant_group (the tenant receivable master).
--   * is_fixed_asset_account — a ledger account linked from assets.assets
--                             (the account that represents a registered asset).
-- Additive (new columns appended at the end) and security_invoker, so existing
-- report queries selecting the earlier columns are unaffected.
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
  cur.code as currency_code,
  coalesce(parent.is_tenant_group, false) as is_tenant_account,
  exists (
    select 1 from assets.assets aa where aa.account_id = coa.id
  ) as is_fixed_asset_account
from accounting.journal_entry_lines jel
  join accounting.journal_entries je on je.id = jel.journal_entry_id
  join accounting.chart_of_accounts coa on coa.id = jel.account_id
  left join accounting.chart_of_accounts parent on parent.id = coa.parent_id
  left join accounting.cost_centers cc on cc.id = jel.cost_center_id
  left join core.currencies cur on cur.id = jel.currency_id
  left join accounting.v_voucher_register vr
    on vr.company_id = je.company_id and vr.voucher_type = je.voucher_type and vr.voucher_id = je.voucher_id
  left join rental.uae_rent_invoices uri on uri.journal_entry_id = je.id
  left join rental.pk_rent_invoices pri on pri.journal_entry_id = je.id
  left join accounting.purchase_vouchers purv on purv.journal_entry_id = je.id
where je.status = 'posted'::text;

alter view reporting.v_ledger_entries set (security_invoker = on);
