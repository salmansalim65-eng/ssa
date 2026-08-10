-- Admin "delete" for a POSTED accounting voucher actually removes it (rather
-- than leaving a reversed document behind): deletes the voucher header (its
-- lines cascade) and its journal entry (lines cascade, plus any reversal that
-- pointed at it). Covers every Phase-5 voucher type + the purchase voucher.
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

  -- A JV Maintenance voucher may reference the journal voucher it was based on;
  -- clear that link so deleting the journal voucher never fails.
  if p_voucher_type = 'journal_voucher' then
    update accounting.jv_maintenance_vouchers set original_jv_id = null where original_jv_id = p_id;
  end if;

  execute format('delete from accounting.%I where id = $1', v_tbl) using p_id;  -- lines cascade

  if v_je is not null then
    delete from accounting.journal_entries where reversal_of = v_je;  -- drop any reversal of it
    delete from accounting.journal_entries where id = v_je;           -- journal_entry_lines cascade
  end if;
end;
$function$;

grant execute on function accounting.fn_admin_delete_posted_voucher(text, uuid) to authenticated;
