-- =============================================================================
-- Allow deleting a DRAFT (unposted) Phase-5 accounting voucher and its journal
-- entry. Covers all eight generic voucher types (receipt, payment, PDC
-- payment/receipt, cheque return, journal, JV maintenance, opening balance),
-- which each store a single header row in accounting.<type>s plus a journal
-- entry; their multi-line data lives in journal_entry_lines (no child voucher
-- line tables). Mirrors fn_delete_draft_purchase_voucher: a definer that
-- checks company + the delete permission + draft status, then removes the
-- approval rows, the voucher header, and the journal entry (+ its lines).
-- Only drafts can be removed — a posted voucher is part of the ledger.
-- =============================================================================

create or replace function accounting.fn_delete_draft_voucher(p_voucher_type text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_company uuid;
  v_je uuid;
  v_status text;
begin
  -- Whitelist voucher_type -> table name (guards the dynamic SQL below).
  v_table := case p_voucher_type
    when 'receipt_voucher' then 'receipt_vouchers'
    when 'payment_voucher' then 'payment_vouchers'
    when 'pdc_payment_voucher' then 'pdc_payment_vouchers'
    when 'pdc_receipt_voucher' then 'pdc_receipt_vouchers'
    when 'cheque_return_voucher' then 'cheque_return_vouchers'
    when 'journal_voucher' then 'journal_vouchers'
    when 'jv_maintenance_voucher' then 'jv_maintenance_vouchers'
    when 'opening_balance_voucher' then 'opening_balance_vouchers'
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
  if v_status <> 'draft' then
    raise exception 'Only draft (unposted) vouchers can be deleted';
  end if;

  delete from accounting.voucher_approvals where voucher_type = p_voucher_type and voucher_id = p_id;
  execute format('delete from accounting.%I where id = $1', v_table) using p_id;
  delete from accounting.journal_entry_lines where journal_entry_id = v_je;
  delete from accounting.journal_entries where id = v_je;
end;
$$;

grant execute on function accounting.fn_delete_draft_voucher(text, uuid) to authenticated, service_role;
