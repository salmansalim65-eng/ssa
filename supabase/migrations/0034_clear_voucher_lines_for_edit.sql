-- =============================================================================
-- Editing a DRAFT Purchase or Sale voucher replaces its line grid. Those line
-- tables (accounting.purchase_voucher_lines, assets.asset_sale_lines) expose
-- only INSERT + SELECT policies — there is no row-level DELETE path — so the
-- app can't clear the old lines directly. These definers clear them, guarded by
-- company + the edit permission + draft status; the caller then re-inserts the
-- new lines through the existing INSERT policy. Only drafts are editable.
-- =============================================================================

create or replace function accounting.fn_clear_purchase_voucher_lines(p_voucher_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_status text;
begin
  select pv.company_id, je.status
    into v_company, v_status
  from accounting.purchase_vouchers pv
  join accounting.journal_entries je on je.id = pv.journal_entry_id
  where pv.id = p_voucher_id;

  if v_company is null then
    raise exception 'Purchase voucher not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('purchase_voucher', 'edit') then
    raise exception 'Not authorized to edit this voucher';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only draft (unposted) vouchers can be edited';
  end if;

  delete from accounting.purchase_voucher_lines where voucher_id = p_voucher_id;
end;
$$;

create or replace function assets.fn_clear_asset_sale_lines(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_status text;
begin
  select s.company_id, je.status
    into v_company, v_status
  from assets.asset_sales s
  join accounting.journal_entries je on je.id = s.journal_entry_id
  where s.id = p_sale_id;

  if v_company is null then
    raise exception 'Sale asset voucher not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('asset_sales', 'edit') then
    raise exception 'Not authorized to edit this voucher';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only draft (unposted) vouchers can be edited';
  end if;

  delete from assets.asset_sale_lines where sale_id = p_sale_id;
end;
$$;

grant execute on function accounting.fn_clear_purchase_voucher_lines(uuid) to authenticated, service_role;
grant execute on function assets.fn_clear_asset_sale_lines(uuid) to authenticated, service_role;
