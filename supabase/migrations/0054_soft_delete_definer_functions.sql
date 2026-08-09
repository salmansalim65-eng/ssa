-- Soft-deleting a row (stamping deleted_at) through the normal RLS-scoped client
-- is rejected, because these tables' SELECT policy filters `deleted_at IS NULL`
-- and the write makes the row fail that visibility check. The established fix in
-- this codebase (see fn_soft_delete_account) is a SECURITY DEFINER function that
-- validates permission + guards references, then stamps deleted_at while bypassing
-- RLS. These three deletes previously did the update directly and failed at
-- runtime ("new row violates row-level security policy").

create or replace function assets.fn_soft_delete_asset(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_cc uuid;
begin
  select company_id into v_company from assets.assets where id = p_id and deleted_at is null;
  if v_company is null then
    raise exception 'Asset not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('assets', 'delete') then
    raise exception 'Not authorized to delete assets';
  end if;

  select id into v_cc from accounting.cost_centers where asset_id = p_id;

  if exists (select 1 from rental.uae_leases where asset_id = p_id)
     or exists (select 1 from rental.pk_leases where asset_id = p_id)
     or exists (select 1 from assets.asset_sales where asset_id = p_id)
     or exists (select 1 from accounting.purchase_voucher_lines where asset_id = p_id)
     or (v_cc is not null and exists (select 1 from accounting.journal_entry_lines where cost_center_id = v_cc))
  then
    raise exception 'This asset cannot be deleted because it is used by leases, sales, purchases or posted accounting entries.';
  end if;

  update assets.assets set deleted_at = now(), deleted_by = auth.uid() where id = p_id;

  if v_cc is not null then
    update accounting.cost_centers set is_active = false where id = v_cc;
  end if;
end;
$function$;

grant execute on function assets.fn_soft_delete_asset(uuid) to authenticated;

create or replace function assets.fn_soft_delete_supplier(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
begin
  select company_id into v_company from assets.suppliers where id = p_id and deleted_at is null;
  if v_company is null then
    raise exception 'Supplier not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('purchase_voucher', 'delete') then
    raise exception 'Not authorized to delete suppliers';
  end if;

  if exists (select 1 from accounting.purchase_vouchers where supplier_id = p_id) then
    raise exception 'This supplier cannot be deleted because it is used by purchase vouchers.';
  end if;

  update assets.suppliers set deleted_at = now() where id = p_id;
end;
$function$;

grant execute on function assets.fn_soft_delete_supplier(uuid) to authenticated;

create or replace function rental.fn_soft_delete_tenant(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
begin
  select company_id into v_company from rental.tenants where id = p_id and deleted_at is null;
  if v_company is null then
    raise exception 'Tenant not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('tenants', 'delete') then
    raise exception 'Not authorized to delete tenants';
  end if;

  if exists (select 1 from rental.uae_leases where tenant_id = p_id)
     or exists (select 1 from rental.pk_leases where tenant_id = p_id)
  then
    raise exception 'This tenant cannot be deleted because it has linked leases (and their invoices/payments).';
  end if;

  update rental.tenants set deleted_at = now() where id = p_id;
end;
$function$;

grant execute on function rental.fn_soft_delete_tenant(uuid) to authenticated;
