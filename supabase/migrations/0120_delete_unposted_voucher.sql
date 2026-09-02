-- A voucher can be deleted until it is POSTED, not only while it is a draft.
--
-- fn_delete_draft_voucher refused anything but 'draft'. That was fine while a
-- new voucher sat as a draft until someone submitted it by hand, but vouchers
-- now go straight to 'pending' on creation — which left a pending voucher with
-- no way to remove it at all: the draft delete refused it, and the admin-only
-- posted delete does not apply either.
--
-- Posting is still the line that makes a voucher permanent: a posted voucher is
-- in the ledger and only accounting.fn_admin_delete_posted_voucher may remove
-- it. Everything short of that — draft, pending, approved, rejected, sent back —
-- has touched no balances and can be deleted by whoever holds the delete
-- permission. The function keeps its name; every caller passes an unposted
-- voucher.

create or replace function accounting.fn_delete_draft_voucher(p_voucher_type text, p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table text;
  v_company uuid;
  v_je uuid;
  v_status text;
begin
  v_table := case p_voucher_type
    when 'receipt_voucher' then 'receipt_vouchers'
    when 'payment_voucher' then 'payment_vouchers'
    when 'pdc_payment_voucher' then 'pdc_payment_vouchers'
    when 'pdc_receipt_voucher' then 'pdc_receipt_vouchers'
    when 'cheque_return_voucher' then 'cheque_return_vouchers'
    when 'journal_voucher' then 'journal_vouchers'
    when 'jv_maintenance_voucher' then 'jv_maintenance_vouchers'
    when 'opening_balance_voucher' then 'opening_balance_vouchers'
    when 'multi_currency_journal' then 'multi_currency_journal_vouchers'
    else null
  end;
  if v_table is null then
    raise exception 'Unsupported voucher type %', p_voucher_type;
  end if;

  execute format(
    'select v.company_id, v.journal_entry_id, je.status
       from accounting.%I v
       join accounting.journal_entries je on je.id = v.journal_entry_id
      where v.id = $1', v_table)
    into v_company, v_je, v_status
    using p_id;

  if v_company is null then
    raise exception 'Voucher not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission(p_voucher_type, 'delete') then
    raise exception 'Not authorized to delete this voucher';
  end if;
  if v_status = 'posted' then
    raise exception 'A posted voucher cannot be deleted here';
  end if;

  delete from accounting.voucher_approvals where voucher_type = p_voucher_type and voucher_id = p_id;
  execute format('delete from accounting.%I where id = $1', v_table) using p_id;
  delete from accounting.journal_entry_lines where journal_entry_id = v_je;
  delete from accounting.journal_entries where id = v_je;
end;
$function$;
