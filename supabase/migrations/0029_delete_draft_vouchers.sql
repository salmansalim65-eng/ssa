-- =============================================================================
-- Allow deleting a DRAFT (unposted) Purchase Voucher or Sale Asset Voucher and
-- its journal entry. Only drafts can be removed — a posted voucher is part of
-- the ledger and must not be deleted. Runs as a definer (there is no DELETE RLS
-- policy on these tables) after checking company + the delete permission +
-- draft status. Lines cascade via their voucher FK.
-- =============================================================================

create or replace function accounting.fn_delete_draft_purchase_voucher(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_je uuid;
  v_status text;
begin
  select pv.company_id, pv.journal_entry_id, je.status
    into v_company, v_je, v_status
  from accounting.purchase_vouchers pv
  join accounting.journal_entries je on je.id = pv.journal_entry_id
  where pv.id = p_id;

  if v_company is null then
    raise exception 'Purchase voucher not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('purchase_voucher', 'delete') then
    raise exception 'Not authorized to delete this voucher';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only draft (unposted) vouchers can be deleted';
  end if;

  delete from accounting.voucher_approvals where voucher_type = 'purchase_voucher' and voucher_id = p_id;
  delete from accounting.purchase_vouchers where id = p_id;
  delete from accounting.journal_entry_lines where journal_entry_id = v_je;
  delete from accounting.journal_entries where id = v_je;
end;
$$;

create or replace function assets.fn_delete_draft_asset_sale(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_je uuid;
  v_status text;
begin
  select s.company_id, s.journal_entry_id, je.status
    into v_company, v_je, v_status
  from assets.asset_sales s
  join accounting.journal_entries je on je.id = s.journal_entry_id
  where s.id = p_id;

  if v_company is null then
    raise exception 'Sale asset voucher not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('asset_sales', 'delete') then
    raise exception 'Not authorized to delete this voucher';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only draft (unposted) vouchers can be deleted';
  end if;

  delete from accounting.voucher_approvals where voucher_type = 'asset_sales' and voucher_id = p_id;
  delete from assets.asset_sales where id = p_id;
  delete from accounting.journal_entry_lines where journal_entry_id = v_je;
  delete from accounting.journal_entries where id = v_je;
end;
$$;

grant execute on function accounting.fn_delete_draft_purchase_voucher(uuid) to authenticated, service_role;
grant execute on function assets.fn_delete_draft_asset_sale(uuid) to authenticated, service_role;
revoke execute on function accounting.fn_delete_draft_purchase_voucher(uuid) from public, anon;
revoke execute on function assets.fn_delete_draft_asset_sale(uuid) from public, anon;
