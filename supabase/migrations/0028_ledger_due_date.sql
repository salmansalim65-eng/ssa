-- =============================================================================
-- Expose a Due Date on ledger lines. A journal entry's due date comes from the
-- source voucher where it has one: UAE / Pakistan rent invoices carry a single
-- due date, and a purchase voucher's earliest installment line stands in for
-- the voucher. CREATE OR REPLACE keeps the existing grants + security_invoker;
-- due_date is appended as a new trailing column.
-- =============================================================================

create or replace view reporting.v_ledger_entries as
select je.company_id,
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
    coalesce(
      uri.due_date,
      pri.due_date,
      (select min(pvl.due_date) from accounting.purchase_voucher_lines pvl where pvl.voucher_id = purv.id)
    ) as due_date
   from accounting.journal_entry_lines jel
     join accounting.journal_entries je on je.id = jel.journal_entry_id
     join accounting.chart_of_accounts coa on coa.id = jel.account_id
     left join accounting.v_voucher_register vr
       on vr.company_id = je.company_id and vr.voucher_type = je.voucher_type and vr.voucher_id = je.voucher_id
     left join rental.uae_rent_invoices uri on uri.journal_entry_id = je.id
     left join rental.pk_rent_invoices pri on pri.journal_entry_id = je.id
     left join accounting.purchase_vouchers purv on purv.journal_entry_id = je.id
  where je.status = 'posted';
