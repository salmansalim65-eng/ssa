-- =============================================================================
-- Edit a lease (UAE / Pakistan) with a full wipe-and-regenerate of its payment
-- schedule (option C). A lease's schedule is normally built by an AFTER INSERT
-- trigger; editing changes the terms, so we rebuild it here.
--
-- Guard: if ANY invoice for the lease is POSTED, the edit is refused — that
-- money is in the ledger and must be reversed first. Unposted (draft) invoices
-- were built from the old schedule/terms, so they are removed (invoice row,
-- journal entry + lines, approvals, and — for PK — utility-charge lines); the
-- adjusted advance rent restores itself from the surviving invoices.
--
-- Runs as a definer after checking company + the edit permission. Regeneration
-- mirrors fn_generate_*_payment_schedule using the new terms.
-- =============================================================================

create or replace function rental.fn_update_uae_lease(
  p_lease_id uuid,
  p_asset_id uuid,
  p_tenant_id uuid,
  p_lease_start date,
  p_lease_end date,
  p_rental_amount numeric,
  p_rent_cycle text,
  p_security_deposit numeric,
  p_currency_id uuid,
  p_due_date date,
  p_rent_month text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_inv_ids uuid[];
  v_je_ids uuid[];
  v_step interval;
  v_due date;
begin
  select company_id into v_company from rental.uae_leases where id = p_lease_id and deleted_at is null;
  if v_company is null then
    raise exception 'Lease not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('uae_rent_invoice', 'edit') then
    raise exception 'Not authorized to edit this lease';
  end if;

  if exists (
    select 1 from rental.uae_rent_invoices i
    join accounting.journal_entries je on je.id = i.journal_entry_id
    where i.lease_id = p_lease_id and je.status = 'posted'
  ) then
    raise exception 'This lease has posted invoices and can no longer be edited; reverse them first';
  end if;

  -- Remove the (unposted) invoices built from the old terms.
  select array_agg(id), array_agg(journal_entry_id)
    into v_inv_ids, v_je_ids
  from rental.uae_rent_invoices where lease_id = p_lease_id;

  if v_inv_ids is not null then
    delete from rental.uae_rent_payments where invoice_id = any(v_inv_ids);
    delete from accounting.voucher_approvals where voucher_type = 'uae_rent_invoice' and voucher_id = any(v_inv_ids);
    delete from rental.uae_rent_invoices where lease_id = p_lease_id;
    delete from accounting.journal_entry_lines where journal_entry_id = any(v_je_ids);
    delete from accounting.journal_entries where id = any(v_je_ids);
  end if;

  delete from rental.uae_payment_schedules where lease_id = p_lease_id;

  update rental.uae_leases set
    asset_id = p_asset_id,
    tenant_id = p_tenant_id,
    lease_start = p_lease_start,
    lease_end = p_lease_end,
    rental_amount = p_rental_amount,
    rent_cycle = p_rent_cycle,
    security_deposit = p_security_deposit,
    currency_id = p_currency_id,
    due_date = p_due_date,
    rent_month = p_rent_month
  where id = p_lease_id;

  v_step := case p_rent_cycle when 'monthly' then interval '1 month' else interval '1 year' end;
  v_due := p_lease_start;
  while v_due <= p_lease_end loop
    insert into rental.uae_payment_schedules (lease_id, due_date, amount) values (p_lease_id, v_due, p_rental_amount);
    v_due := (v_due + v_step)::date;
  end loop;
end;
$$;

create or replace function rental.fn_update_pk_lease(
  p_lease_id uuid,
  p_asset_id uuid,
  p_tenant_id uuid,
  p_lease_start date,
  p_lease_end date,
  p_monthly_rent numeric,
  p_advance_rent numeric,
  p_security_deposit numeric,
  p_currency_id uuid,
  p_due_date date,
  p_rent_month text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_inv_ids uuid[];
  v_je_ids uuid[];
  v_due date;
begin
  select company_id into v_company from rental.pk_leases where id = p_lease_id and deleted_at is null;
  if v_company is null then
    raise exception 'Lease not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('pk_rent_invoice', 'edit') then
    raise exception 'Not authorized to edit this lease';
  end if;

  if exists (
    select 1 from rental.pk_rent_invoices i
    join accounting.journal_entries je on je.id = i.journal_entry_id
    where i.lease_id = p_lease_id and je.status = 'posted'
  ) then
    raise exception 'This lease has posted invoices and can no longer be edited; reverse them first';
  end if;

  select array_agg(id), array_agg(journal_entry_id)
    into v_inv_ids, v_je_ids
  from rental.pk_rent_invoices where lease_id = p_lease_id;

  if v_inv_ids is not null then
    delete from rental.pk_rent_payments where invoice_id = any(v_inv_ids);
    delete from rental.pk_utility_charges where invoice_id = any(v_inv_ids);
    delete from accounting.voucher_approvals where voucher_type = 'pk_rent_invoice' and voucher_id = any(v_inv_ids);
    delete from rental.pk_rent_invoices where lease_id = p_lease_id;
    delete from accounting.journal_entry_lines where journal_entry_id = any(v_je_ids);
    delete from accounting.journal_entries where id = any(v_je_ids);
  end if;

  delete from rental.pk_payment_schedules where lease_id = p_lease_id;

  update rental.pk_leases set
    asset_id = p_asset_id,
    tenant_id = p_tenant_id,
    lease_start = p_lease_start,
    lease_end = p_lease_end,
    monthly_rent = p_monthly_rent,
    advance_rent = p_advance_rent,
    security_deposit = p_security_deposit,
    currency_id = p_currency_id,
    due_date = p_due_date,
    rent_month = p_rent_month
  where id = p_lease_id;

  v_due := p_lease_start;
  while v_due <= p_lease_end loop
    insert into rental.pk_payment_schedules (lease_id, due_date, amount) values (p_lease_id, v_due, p_monthly_rent);
    v_due := (v_due + interval '1 month')::date;
  end loop;
end;
$$;

grant execute on function rental.fn_update_uae_lease(uuid, uuid, uuid, date, date, numeric, text, numeric, uuid, date, text)
  to authenticated, service_role;
grant execute on function rental.fn_update_pk_lease(uuid, uuid, uuid, date, date, numeric, numeric, numeric, uuid, date, text)
  to authenticated, service_role;
