-- Let someone correct the posted expense voucher THEY raised.
--
-- Editing a posted voucher means removing it and re-creating it from the edited
-- values, because a posted journal entry is immutable at the database level.
-- The only function that could do that removal, fn_admin_delete_posted_voucher,
-- demands core.is_admin() — reasonable for a receipt against a tenant's ledger,
-- but wrong for an expense voucher, which posts the moment it is created and is
-- raised by the assistant who spent the money. A wrong amount or a wrong tag is
-- noticed afterwards, and with no correction of their own the assistant has to
-- find an administrator for a Rs 500 grocery bill.
--
-- So expense vouchers get their own removal function. It is narrower than the
-- admin one in every direction: this voucher type only, the caller's own
-- company only, and — unless they are an administrator — only a voucher they
-- created, only with the edit permission on the type. Nothing here lets anyone
-- touch a voucher they could not already have raised.

create or replace function accounting.fn_delete_posted_expense_voucher(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_je uuid;
  v_created_by uuid;
begin
  select ev.company_id, ev.journal_entry_id, ev.created_by
    into v_company, v_je, v_created_by
  from accounting.expense_vouchers ev
  where ev.id = p_id;

  if v_company is null then
    raise exception 'Voucher not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;

  -- An administrator may correct anyone's. Everyone else: their own voucher,
  -- and only holding the edit permission for this voucher type.
  if not core.is_admin() then
    if v_created_by is distinct from auth.uid() then
      raise exception 'You can only edit an expense voucher you raised';
    end if;
    if not core.user_has_permission('expense_voucher', 'edit') then
      raise exception 'Not permitted: expense_voucher.edit';
    end if;
  end if;

  delete from accounting.expense_vouchers where id = p_id;

  if v_je is not null then
    delete from accounting.journal_entries where reversal_of = v_je;
    delete from accounting.journal_entries where id = v_je;
  end if;
end;
$function$;

comment on function accounting.fn_delete_posted_expense_voucher(uuid) is
  'Removes a posted expense voucher so an edit can be re-created in its place. Admins may remove any; everyone else only the vouchers they raised, with expense_voucher.edit.';

grant execute on function accounting.fn_delete_posted_expense_voucher(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
