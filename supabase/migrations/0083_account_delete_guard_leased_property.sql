-- Block deleting a Chart-of-Accounts account that is a rental property with
-- active leases. The previous guard only checked child accounts and journal
-- lines, so a property account (linked_asset_id set) whose asset still had a
-- lease could be soft-deleted — which is how SHAMAL was removed despite a lease.

create or replace function accounting.fn_soft_delete_account(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_asset_id uuid;
begin
  -- Active child accounts.
  if exists (
    select 1 from accounting.chart_of_accounts
    where parent_id = p_id and deleted_at is null
  ) then
    raise exception 'This account has active child accounts and cannot be deleted. Delete or reassign them first.';
  end if;

  -- Any ledger / transaction history.
  if exists (
    select 1 from accounting.journal_entry_lines where account_id = p_id
  ) then
    raise exception 'This account cannot be deleted because it is being used in accounting transactions.';
  end if;

  -- Linked property with active leases.
  select linked_asset_id into v_asset_id
  from accounting.chart_of_accounts where id = p_id;
  if v_asset_id is not null and (
    exists (select 1 from rental.uae_leases where asset_id = v_asset_id and deleted_at is null)
    or exists (select 1 from rental.pk_leases  where asset_id = v_asset_id and deleted_at is null)
  ) then
    raise exception 'This account is a property with active leases and cannot be deleted. Remove its leases first.';
  end if;

  update accounting.chart_of_accounts
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_id;
end;
$function$;
