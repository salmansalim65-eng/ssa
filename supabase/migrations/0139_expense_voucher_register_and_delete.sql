-- Expense vouchers had to be taught to two places that still did not know them.
--
-- 1. accounting.v_voucher_register resolves a journal entry's voucher number by
--    joining every voucher table in turn. Without accounting.expense_vouchers in
--    that list a posted expense voucher came back with voucher_no NULL, so the
--    register and the general ledger built on top of it showed it as "Draft".
--
-- 2. accounting.fn_admin_delete_posted_voucher maps a voucher type to its table.
--    An unknown type raises "Unsupported voucher type", which is what an admin
--    editing a POSTED expense voucher would have hit, because that edit path
--    deletes the posted voucher and re-creates it.

create or replace view accounting.v_voucher_register as
 SELECT je.company_id,
    je.voucher_type,
    je.voucher_id,
    je.entry_date,
    COALESCE(rv.voucher_no, pv.voucher_no, ppv.voucher_no, prv.voucher_no, crv.voucher_no, jv.voucher_no,
             jvm.voucher_no, obv.voucher_no, purv.voucher_no, uri.voucher_no, pri.voucher_no, asv.voucher_no,
             mcj.voucher_no, exv.voucher_no) AS voucher_no,
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
     LEFT JOIN accounting.multi_currency_journal_vouchers mcj ON mcj.journal_entry_id = je.id
     LEFT JOIN accounting.expense_vouchers exv ON exv.journal_entry_id = je.id;

create or replace function accounting.fn_admin_delete_posted_voucher(p_voucher_type text, p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_je uuid;
  v_tbl text;
begin
  if not core.is_admin() then
    raise exception 'Only administrators can delete posted vouchers';
  end if;

  v_tbl := case p_voucher_type
    when 'receipt_voucher' then 'receipt_vouchers'
    when 'payment_voucher' then 'payment_vouchers'
    when 'pdc_payment_voucher' then 'pdc_payment_vouchers'
    when 'pdc_receipt_voucher' then 'pdc_receipt_vouchers'
    when 'cheque_return_voucher' then 'cheque_return_vouchers'
    when 'journal_voucher' then 'journal_vouchers'
    when 'jv_maintenance_voucher' then 'jv_maintenance_vouchers'
    when 'opening_balance_voucher' then 'opening_balance_vouchers'
    when 'purchase_voucher' then 'purchase_vouchers'
    when 'multi_currency_journal' then 'multi_currency_journal_vouchers'
    when 'expense_voucher' then 'expense_vouchers'
    else null
  end;
  if v_tbl is null then
    raise exception 'Unsupported voucher type %', p_voucher_type;
  end if;

  execute format('select company_id, journal_entry_id from accounting.%I where id = $1', v_tbl)
    into v_company, v_je using p_id;
  if v_company is null then
    raise exception 'Voucher not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;

  if p_voucher_type = 'journal_voucher' then
    update accounting.jv_maintenance_vouchers set original_jv_id = null where original_jv_id = p_id;
  end if;

  execute format('delete from accounting.%I where id = $1', v_tbl) using p_id;

  if v_je is not null then
    delete from accounting.journal_entries where reversal_of = v_je;
    delete from accounting.journal_entries where id = v_je;
  end if;
end;
$function$;

grant execute on function accounting.fn_admin_delete_posted_voucher(text, uuid) to authenticated;
