-- Pending fix: run once in Supabase → SQL Editor. Safe to re-run.
-- ============================================================================
-- Edit a UAE payment-schedule row's due date
-- Move a month's rent (and the invoice it generated) to a different due date —
-- e.g. pull September's rent forward to be due in August so August shows both
-- months' amount due. rental.uae_payment_schedules has only a SELECT policy (no
-- UPDATE policy), so this runs as a SECURITY DEFINER function that re-checks the
-- company and the uae_rent_invoice edit permission before writing.
-- ============================================================================
create or replace function rental.fn_update_uae_schedule_due_date(p_schedule_id uuid, p_due_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select l.company_id
    into v_company
  from rental.uae_payment_schedules s
  join rental.uae_leases l on l.id = s.lease_id
  where s.id = p_schedule_id;

  if v_company is null then
    raise exception 'Schedule row not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('uae_rent_invoice', 'edit') then
    raise exception 'Not authorized to edit invoices';
  end if;

  -- Once a row is invoiced, the Rent Balance / dashboard bucket by the INVOICE's
  -- due date, so move only that (the schedule row keeps its date — moving it onto
  -- another month's date would violate the (lease_id, due_date) unique key). A
  -- not-yet-invoiced row has no invoice, so move the schedule row itself.
  if exists (select 1 from rental.uae_rent_invoices where schedule_id = p_schedule_id) then
    update rental.uae_rent_invoices set due_date = p_due_date where schedule_id = p_schedule_id;
  else
    update rental.uae_payment_schedules set due_date = p_due_date where id = p_schedule_id;
  end if;
end;
$$;

grant execute on function rental.fn_update_uae_schedule_due_date(uuid, date) to authenticated;
