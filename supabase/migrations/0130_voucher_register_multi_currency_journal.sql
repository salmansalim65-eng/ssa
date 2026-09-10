-- The voucher register never knew a multi-currency journal's number.
--
-- v_voucher_register resolves a journal entry's voucher number by joining every
-- voucher table in turn — and accounting.multi_currency_journal_vouchers was
-- missing from that list. So a posted MCJ came back with voucher_no NULL, and
-- every screen reading the register or the ledger view built on it (which takes
-- its voucher_no from here) showed it as "Draft" with no narration or cost
-- centre against it, even though the entry was posted.
--
-- Adding the join fixes the register, the general ledger and everything else
-- downstream at once.

create or replace view accounting.v_voucher_register as
 SELECT je.company_id,
    je.voucher_type,
    je.voucher_id,
    je.entry_date,
    COALESCE(rv.voucher_no, pv.voucher_no, ppv.voucher_no, prv.voucher_no, crv.voucher_no, jv.voucher_no,
             jvm.voucher_no, obv.voucher_no, purv.voucher_no, uri.voucher_no, pri.voucher_no, asv.voucher_no,
             mcj.voucher_no) AS voucher_no,
    je.currency_id,
    je.status,
    je.narration,
    je.created_by,
    je.created_at,
    je.posted_by,
    je.posted_at,
    ( SELECT COALESCE(sum(l.base_debit_amount), 0::numeric)
           FROM accounting.journal_entry_lines l
          WHERE l.journal_entry_id = je.id) AS amount,
    ( SELECT COALESCE(sum(l.debit_amount), 0::numeric)
           FROM accounting.journal_entry_lines l
          WHERE l.journal_entry_id = je.id) AS doc_amount
   FROM accounting.journal_entries je
     LEFT JOIN accounting.receipt_vouchers rv ON rv.journal_entry_id = je.id
     LEFT JOIN accounting.payment_vouchers pv ON pv.journal_entry_id = je.id
     LEFT JOIN accounting.pdc_payment_vouchers ppv ON ppv.journal_entry_id = je.id
     LEFT JOIN accounting.pdc_receipt_vouchers prv ON prv.journal_entry_id = je.id
     LEFT JOIN accounting.cheque_return_vouchers crv ON crv.journal_entry_id = je.id
     LEFT JOIN accounting.journal_vouchers jv ON jv.journal_entry_id = je.id
     LEFT JOIN accounting.jv_maintenance_vouchers jvm ON jvm.journal_entry_id = je.id
     LEFT JOIN accounting.opening_balance_vouchers obv ON obv.journal_entry_id = je.id
     LEFT JOIN accounting.purchase_vouchers purv ON purv.journal_entry_id = je.id
     LEFT JOIN rental.uae_rent_invoices uri ON uri.journal_entry_id = je.id
     LEFT JOIN rental.pk_rent_invoices pri ON pri.journal_entry_id = je.id
     LEFT JOIN assets.asset_sales asv ON asv.journal_entry_id = je.id
     LEFT JOIN accounting.multi_currency_journal_vouchers mcj ON mcj.journal_entry_id = je.id;
