-- Teach the voucher register (which the General Ledger reads voucher_no from)
-- about the Multi-Currency Journal, so its posted entries show their MCJ- number
-- instead of falling back to "Draft".
create or replace view accounting.v_voucher_register as
select
  je.company_id,
  je.voucher_type,
  je.voucher_id,
  je.entry_date,
  coalesce(rv.voucher_no, pv.voucher_no, ppv.voucher_no, prv.voucher_no, crv.voucher_no,
           jv.voucher_no, jvm.voucher_no, obv.voucher_no, purv.voucher_no,
           uri.voucher_no, pri.voucher_no, asv.voucher_no, mcj.voucher_no) as voucher_no,
  je.currency_id,
  je.status,
  je.narration,
  je.created_by,
  je.created_at,
  je.posted_by,
  je.posted_at,
  (select coalesce(sum(l.base_debit_amount), 0)
     from accounting.journal_entry_lines l where l.journal_entry_id = je.id) as amount,
  (select coalesce(sum(l.debit_amount), 0)
     from accounting.journal_entry_lines l where l.journal_entry_id = je.id) as doc_amount
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
  left join rental.uae_rent_invoices uri on uri.journal_entry_id = je.id
  left join rental.pk_rent_invoices pri on pri.journal_entry_id = je.id
  left join assets.asset_sales asv on asv.journal_entry_id = je.id
  left join accounting.multi_currency_journal_vouchers mcj on mcj.journal_entry_id = je.id;

alter view accounting.v_voucher_register set (security_invoker = on);
