-- Deleting a tenant was blocked by leases that had already been (soft-)deleted:
-- fn_delete_uae_lease / fn_delete_pk_lease stamp deleted_at rather than removing
-- the row, but the tenant guard counted every lease regardless. Only live
-- (deleted_at is null) leases should block a tenant delete.
create or replace function rental.fn_soft_delete_tenant(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_company uuid;
begin
  select company_id into v_company from rental.tenants where id = p_id and deleted_at is null;
  if v_company is null then raise exception 'Tenant not found'; end if;
  if core.current_company_id() is distinct from v_company then raise exception 'Not authorized for this company'; end if;
  if not core.user_has_permission('tenants', 'delete') then raise exception 'Not authorized to delete tenants'; end if;
  if exists (select 1 from rental.uae_leases where tenant_id = p_id and deleted_at is null)
     or exists (select 1 from rental.pk_leases where tenant_id = p_id and deleted_at is null)
  then
    raise exception 'This tenant cannot be deleted because it has linked leases (and their invoices/payments).';
  end if;
  update rental.tenants set deleted_at = now() where id = p_id;
end;
$function$;

-- Same fix for the asset guard: uae_leases / pk_leases soft-delete, so a
-- previously deleted lease should no longer block deleting its asset. (The
-- other referenced children — asset sales, purchase-voucher lines and journal
-- lines — are physically deleted, so those checks stay as-is.)
create or replace function assets.fn_soft_delete_asset(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_company uuid; v_cc uuid;
begin
  select company_id into v_company from assets.assets where id = p_id and deleted_at is null;
  if v_company is null then raise exception 'Asset not found'; end if;
  if core.current_company_id() is distinct from v_company then raise exception 'Not authorized for this company'; end if;
  if not core.user_has_permission('assets', 'delete') then raise exception 'Not authorized to delete assets'; end if;
  select id into v_cc from accounting.cost_centers where asset_id = p_id;
  if exists (select 1 from rental.uae_leases where asset_id = p_id and deleted_at is null)
     or exists (select 1 from rental.pk_leases where asset_id = p_id and deleted_at is null)
     or exists (select 1 from assets.asset_sales where asset_id = p_id)
     or exists (select 1 from accounting.purchase_voucher_lines where asset_id = p_id)
     or (v_cc is not null and exists (select 1 from accounting.journal_entry_lines where cost_center_id = v_cc))
  then
    raise exception 'This asset cannot be deleted because it is used by leases, sales, purchases or posted accounting entries.';
  end if;
  update assets.assets set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  if v_cc is not null then update accounting.cost_centers set is_active = false where id = v_cc; end if;
end;
$function$;
