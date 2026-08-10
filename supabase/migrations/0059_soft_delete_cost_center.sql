-- Deleting a cost center failed with "new row violates row-level security policy
-- for table cost_centers". Same latent bug fixed in 0054 for assets/suppliers/
-- tenants: the cost_centers SELECT policy filters `deleted_at IS NULL`, so stamping
-- deleted_at through the RLS-scoped client makes the row fail its own visibility
-- check and the write is rejected. The fix follows the established
-- fn_soft_delete_* pattern — a SECURITY DEFINER function that validates company +
-- delete permission, guards references, then soft-deletes while bypassing RLS.

create or replace function accounting.fn_soft_delete_cost_center(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
begin
  select company_id into v_company
  from accounting.cost_centers
  where id = p_id and deleted_at is null;
  if v_company is null then
    raise exception 'Cost center not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('cost_centers', 'delete') then
    raise exception 'Not authorized to delete cost centers';
  end if;

  if exists (select 1 from accounting.journal_entry_lines where cost_center_id = p_id) then
    raise exception 'This cost center cannot be deleted because it is used by posted accounting entries.';
  end if;

  if exists (
    select 1 from accounting.cost_centers
    where parent_id = p_id and deleted_at is null
  ) then
    raise exception 'This cost center cannot be deleted because it has child cost centers.';
  end if;

  update accounting.cost_centers
  set deleted_at = now(), deleted_by = auth.uid(), is_active = false
  where id = p_id;
end;
$function$;

grant execute on function accounting.fn_soft_delete_cost_center(uuid) to authenticated;
