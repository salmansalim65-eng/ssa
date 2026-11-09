-- Removing a statement, and everything that stands on it.
--
-- A statement is not one row. It is the sheet, its lines, the journal entry it
-- posted, the bills that entry raised, and the lease invoices its long-term
-- lines claimed. Deleting the sheet alone would leave bills nobody can explain
-- and lease invoices still marked as claimed by a statement that is gone.
--
-- What it REFUSES is the important part. Once a receipt has been adjusted
-- against a bill, deleting that bill would quietly unallocate the money: the
-- cash stays in the bank, the rent goes back to outstanding, and nothing says
-- why. So a statement whose bills have been settled, in whole or in part,
-- cannot be deleted at all — it has to be undone from the receipt first.

create or replace function rental.fn_delete_rent_statement(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company uuid;
  v_je uuid;
  v_settled numeric;
begin
  select company_id, journal_entry_id into v_company, v_je
  from rental.rent_statements where id = p_id;
  if v_company is null then
    raise exception 'Statement not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('rent_statement', 'delete') then
    raise exception 'Not permitted to delete a rent statement';
  end if;

  -- Money already set against any of its bills.
  select coalesce(sum(x.amount), 0) into v_settled
  from (
    select ra.amount
      from rental.receipt_invoice_allocations ra
      join rental.uae_rent_invoices i on i.id = ra.uae_invoice_id
      join rental.rent_statement_lines sl on sl.id = i.rent_statement_line_id
     where sl.statement_id = p_id and i.lease_id is null
    union all
    select ja.amount
      from rental.journal_invoice_allocations ja
      join rental.uae_rent_invoices i on i.id = ja.uae_invoice_id
      join rental.rent_statement_lines sl on sl.id = i.rent_statement_line_id
     where sl.statement_id = p_id and i.lease_id is null
  ) x;
  if v_settled <> 0 then
    raise exception
      'This statement cannot be deleted: % has been adjusted against its bills. Undo that on the receipt first.',
      v_settled;
  end if;

  -- A lease invoice a long-term line merely CLAIMED goes back to unclaimed; it
  -- belongs to its lease and was never this statement's to delete.
  update rental.uae_rent_invoices i
     set rent_statement_line_id = null
    from rental.rent_statement_lines sl
   where sl.id = i.rent_statement_line_id
     and sl.statement_id = p_id
     and i.lease_id is not null;

  -- The bills this statement raised are its own.
  delete from rental.uae_rent_invoices i
   using rental.rent_statement_lines sl
   where sl.id = i.rent_statement_line_id
     and sl.statement_id = p_id
     and i.lease_id is null;

  delete from rental.rent_statements where id = p_id;

  if v_je is not null then
    delete from accounting.journal_entries where reversal_of = v_je;
    delete from accounting.journal_entries where id = v_je;
  end if;
end;
$$;

revoke all on function rental.fn_delete_rent_statement(uuid) from public;
grant execute on function rental.fn_delete_rent_statement(uuid) to authenticated;

comment on function rental.fn_delete_rent_statement(uuid) is
  'Deletes a rent statement with its lines, bills and journal entry, and unclaims the lease invoices its long-term lines matched. Refuses outright once anything has been adjusted against its bills.';
