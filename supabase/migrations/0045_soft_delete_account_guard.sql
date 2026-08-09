-- Safe soft-delete for chart-of-accounts: refuses accounts that have active
-- children or that appear in any posted/draft accounting transaction, otherwise
-- stamps deleted_at/deleted_by. Replaces the raw update path that could silently
-- orphan ledger references.
create or replace function accounting.fn_soft_delete_account(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
begin
  select company_id into v_company
  from accounting.chart_of_accounts
  where id = p_id and deleted_at is null;

  if v_company is null then
    raise exception 'Account not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('chart_of_accounts', 'delete') then
    raise exception 'Not authorized to delete accounts';
  end if;

  if exists (
    select 1 from accounting.chart_of_accounts
    where parent_id = p_id and deleted_at is null
  ) then
    raise exception 'This account has active child accounts and cannot be deleted. Remove or reassign them first.';
  end if;

  -- journal_entry_lines is the single sink for every posted/draft voucher, so a
  -- reference here means the account is used in accounting transactions.
  if exists (
    select 1 from accounting.journal_entry_lines where account_id = p_id
  ) then
    raise exception 'This account cannot be deleted because it is being used in accounting transactions.';
  end if;

  update accounting.chart_of_accounts
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_id;
end;
$function$;

grant execute on function accounting.fn_soft_delete_account(uuid) to authenticated;
