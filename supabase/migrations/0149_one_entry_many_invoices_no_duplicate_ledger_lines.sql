-- A rent statement posts ONE journal entry and raises many invoices against
-- it. Both of these views reached the invoice with a LEFT JOIN on
-- journal_entry_id, which was 1:1 until that happened — so every ledger line
-- of the statement came out nine times, and v_voucher_register multiplied it
-- nine times again: 486 rows for a six-line entry, and a ledger showing the
-- agent owing 2.2 million instead of 26,829.
--
-- Neither view wants the invoice itself, only one value off it, so each takes
-- it as a scalar subquery. A journal entry is a row in these views; what hangs
-- off it must never change how many rows it is.

create or replace view accounting.v_voucher_register as
select
  je.company_id,
  je.voucher_type,
  je.voucher_id,
  je.entry_date,
  coalesce(
    rv.voucher_no, pv.voucher_no, ppv.voucher_no, prv.voucher_no, crv.voucher_no,
    jv.voucher_no, jvm.voucher_no, obv.voucher_no, purv.voucher_no,
    -- A statement names itself; its invoices carry their own numbers.
    rs.voucher_no,
    (select min(u.voucher_no) from rental.uae_rent_invoices u where u.journal_entry_id = je.id),
    (select min(p.voucher_no) from rental.pk_rent_invoices p where p.journal_entry_id = je.id),
    asv.voucher_no, mcj.voucher_no, exv.voucher_no
  ) as voucher_no,
  je.currency_id,
  je.status,
  je.narration,
  je.created_by,
  je.created_at,
  je.posted_by,
  je.posted_at,
  (select coalesce(sum(l.base_debit_amount), 0::numeric) from accounting.journal_entry_lines l where l.journal_entry_id = je.id) as amount,
  (select coalesce(sum(l.debit_amount), 0::numeric) from accounting.journal_entry_lines l where l.journal_entry_id = je.id) as doc_amount
from accounting.journal_entries je
  left join accounting.receipt_vouchers rv on rv.journal_entry_id = je.id
  left join accounting.payment_vouchers pv on pv.journal_entry_id = je.id
  left join accounting.pdc_payment_vouchers ppv on ppv.journal_entry_id = je.id
  left join accounting.pdc_receipt_vouchers prv on prv.journal_entry_id = je.id
  left join accounting.cheque_return_vouchers crv on crv.journal_entry_id = je.id
  left join accounting.journal_vouchers jv on jv.journal_entry_id = je.id
  left join accounting.jv_maintenance_vouchers jvm on jvm.journal_entry_id = je.id
  left join accounting.opening_balance_vouchers obv on obv.journal_entry_id = je.id
  left join accounting.purchase_vouchers purv on purv.journal_entry_id = je.id
  left join rental.rent_statements rs on rs.journal_entry_id = je.id
  left join assets.asset_sales asv on asv.journal_entry_id = je.id
  left join accounting.multi_currency_journal_vouchers mcj on mcj.journal_entry_id = je.id
  left join accounting.expense_vouchers exv on exv.journal_entry_id = je.id;

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
  -- The earliest month this entry bills for. An entry behind several bills has
  -- several due dates; the first is the one the ledger's "due by" split needs.
  coalesce(
    (select min(u.due_date) from rental.uae_rent_invoices u where u.journal_entry_id = je.id),
    (select min(p.due_date) from rental.pk_rent_invoices p where p.journal_entry_id = je.id),
    (select min(pvl.due_date)
       from accounting.purchase_voucher_lines pvl
       join accounting.purchase_vouchers pv on pv.id = pvl.voucher_id
      where pv.journal_entry_id = je.id)
  ) as due_date,
  cc.country as cost_center_country,
  jel.debit_amount as doc_debit_amount,
  jel.credit_amount as doc_credit_amount,
  cur.code as currency_code,
  coalesce(parent.is_tenant_group, false) as is_tenant_account,
  (exists (select 1 from assets.assets aa where aa.account_id = coa.id)) as is_fixed_asset_account
from accounting.journal_entry_lines jel
  join accounting.journal_entries je on je.id = jel.journal_entry_id
  join accounting.chart_of_accounts coa on coa.id = jel.account_id
  left join accounting.chart_of_accounts parent on parent.id = coa.parent_id
  left join accounting.cost_centers cc on cc.id = jel.cost_center_id
  left join core.currencies cur on cur.id = jel.currency_id
  left join accounting.v_voucher_register vr
    on vr.company_id = je.company_id and vr.voucher_type = je.voucher_type and vr.voucher_id = je.voucher_id
where je.status = 'posted';
