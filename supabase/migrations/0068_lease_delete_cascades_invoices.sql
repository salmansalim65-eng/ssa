-- Deleting a lease used to only stamp deleted_at on the lease row, leaving its
-- invoices — and, crucially, the POSTED invoices' journal entries — untouched.
-- The rental income therefore lingered in every financial report even though
-- the lease looked "deleted". Users had no way to clear it from the lease page
-- (the per-period delete only removes drafts).
--
-- Both delete functions now cascade: for every invoice on the lease they delete
-- the invoice and its journal entry (posted or draft), then soft-delete the
-- lease record itself (business data retention convention). Rent invoices are
-- regenerable from the schedule, so removing them outright — rather than leaving
-- reversed documents behind — matches rental.fn_admin_delete_rent_invoice.
--
-- Deleting the parent journal_entries row lets its lines cascade away without
-- tripping the posted-line immutability guard (that guard only fires on a direct
-- change to a line whose parent entry is still posted). A lease whose invoices
-- carry recorded payments is refused, so cash already received is never silently
-- dropped — remove the payments first.

create or replace function rental.fn_delete_uae_lease(p_lease_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_payments int;
  v_je_ids uuid[];
begin
  select company_id into v_company
  from rental.uae_leases
  where id = p_lease_id and deleted_at is null;

  if v_company is null then
    raise exception 'Lease not found or already deleted';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('uae_rent_invoice', 'delete') then
    raise exception 'Not authorized to delete this lease';
  end if;

  -- Any payment on any invoice of this lease blocks the delete.
  select count(*) into v_payments
  from rental.uae_rent_payments p
  join rental.uae_rent_invoices i on i.id = p.invoice_id
  where i.lease_id = p_lease_id;
  if v_payments > 0 then
    raise exception 'This lease has invoices with recorded payments and cannot be deleted. Remove the payments first.';
  end if;

  select array_agg(journal_entry_id) into v_je_ids
  from rental.uae_rent_invoices
  where lease_id = p_lease_id and journal_entry_id is not null;

  -- Drop reversal entries pointing at this lease's journal entries first
  -- (reversal_of is ON DELETE SET NULL, and nulling a posted reversal is blocked).
  if v_je_ids is not null then
    delete from accounting.journal_entries where reversal_of = any(v_je_ids);
  end if;

  -- Reopen the schedule periods, remove the invoices, then their journal entries.
  update rental.uae_payment_schedules set status = 'pending' where lease_id = p_lease_id;
  delete from rental.uae_rent_invoices where lease_id = p_lease_id;
  if v_je_ids is not null then
    delete from accounting.journal_entries where id = any(v_je_ids);  -- lines cascade
  end if;

  update rental.uae_leases
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_lease_id;
end;
$$;

create or replace function rental.fn_delete_pk_lease(p_lease_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_payments int;
  v_je_ids uuid[];
begin
  select company_id into v_company
  from rental.pk_leases
  where id = p_lease_id and deleted_at is null;

  if v_company is null then
    raise exception 'Lease not found or already deleted';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('pk_rent_invoice', 'delete') then
    raise exception 'Not authorized to delete this lease';
  end if;

  select count(*) into v_payments
  from rental.pk_rent_payments p
  join rental.pk_rent_invoices i on i.id = p.invoice_id
  where i.lease_id = p_lease_id;
  if v_payments > 0 then
    raise exception 'This lease has invoices with recorded payments and cannot be deleted. Remove the payments first.';
  end if;

  select array_agg(journal_entry_id) into v_je_ids
  from rental.pk_rent_invoices
  where lease_id = p_lease_id and journal_entry_id is not null;

  if v_je_ids is not null then
    delete from accounting.journal_entries where reversal_of = any(v_je_ids);
  end if;

  update rental.pk_payment_schedules set status = 'pending' where lease_id = p_lease_id;
  delete from rental.pk_rent_invoices where lease_id = p_lease_id;  -- pk_utility_charges cascade
  if v_je_ids is not null then
    delete from accounting.journal_entries where id = any(v_je_ids);  -- lines cascade
  end if;

  update rental.pk_leases
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_lease_id;
end;
$$;

comment on function rental.fn_delete_uae_lease(uuid) is
  'Deletes a UAE/HH lease: removes every invoice on the lease and its journal entry (posted or draft), reopens the schedule, then soft-deletes the lease. Refuses when any invoice has recorded payments.';
comment on function rental.fn_delete_pk_lease(uuid) is
  'Deletes a Pakistan lease: removes every invoice on the lease and its journal entry (posted or draft), reopens the schedule, then soft-deletes the lease. Refuses when any invoice has recorded payments.';

grant execute on function rental.fn_delete_uae_lease(uuid) to authenticated, service_role;
grant execute on function rental.fn_delete_pk_lease(uuid) to authenticated, service_role;
revoke execute on function rental.fn_delete_uae_lease(uuid) from public, anon;
revoke execute on function rental.fn_delete_pk_lease(uuid) from public, anon;
