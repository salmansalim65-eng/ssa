-- PK payment-schedule due dates must follow the lease due-date's DAY-OF-MONTH
-- (e.g. the 20th every period), not the day taken from lease_start. Migration
-- 0074 rewrote the PK generator to fix per-cycle amounts but regressed the
-- day-of-month anchoring (it stepped from lease_start), so a lease starting on
-- the 1st with a due date on the 20th produced schedules dated the 1st.
--
-- This restores the anchoring (via rental.fn_schedule_due_dates, which clamps
-- the day for short months) while keeping the per-cycle amount = monthly_rent x
-- months covered. Both the INSERT trigger and the edit RPC are corrected.

-- Schedule generator: due dates anchored to the lease due-date day, amount =
-- monthly_rent x months the period covers.
create or replace function rental.fn_generate_pk_payment_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step_months int := case new.rent_cycle when 'quarterly' then 3 when 'yearly' then 12 else 1 end;
  v_due date;
  v_next date;
  v_months int;
begin
  for v_due in
    select d from rental.fn_schedule_due_dates(
      coalesce(new.due_date, new.lease_start), new.lease_start, new.lease_end, v_step_months
    ) as d
  loop
    v_next := least((v_due + (v_step_months || ' months')::interval)::date, (new.lease_end + 1));
    v_months := greatest(1, (extract(year from age(v_next, v_due)) * 12
                             + extract(month from age(v_next, v_due)))::int);
    insert into rental.pk_payment_schedules (lease_id, due_date, amount)
    values (new.id, v_due, new.monthly_rent * v_months);
  end loop;
  return new;
end;
$$;

-- Edit RPC: same 13-arg signature as 0074, with the corrected anchoring.
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
  p_rent_month text,
  p_official_rent numeric,
  p_rent_cycle text
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
  v_step_months int;
  v_due date;
  v_next date;
  v_months int;
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
    rent_month = p_rent_month,
    official_rent = p_official_rent,
    rent_cycle = coalesce(p_rent_cycle, 'monthly')
  where id = p_lease_id;

  v_step_months := case coalesce(p_rent_cycle, 'monthly') when 'quarterly' then 3 when 'yearly' then 12 else 1 end;
  for v_due in
    select d from rental.fn_schedule_due_dates(
      coalesce(p_due_date, p_lease_start), p_lease_start, p_lease_end, v_step_months
    ) as d
  loop
    v_next := least((v_due + (v_step_months || ' months')::interval)::date, (p_lease_end + 1));
    v_months := greatest(1, (extract(year from age(v_next, v_due)) * 12
                             + extract(month from age(v_next, v_due)))::int);
    insert into rental.pk_payment_schedules (lease_id, due_date, amount)
    values (p_lease_id, v_due, p_monthly_rent * v_months);
  end loop;
end;
$$;

grant execute on function rental.fn_update_pk_lease(uuid, uuid, uuid, date, date, numeric, numeric, numeric, uuid, date, text, numeric, text)
  to authenticated, service_role;
revoke execute on function rental.fn_update_pk_lease(uuid, uuid, uuid, date, date, numeric, numeric, numeric, uuid, date, text, numeric, text)
  from public, anon;

-- Backfill existing PK schedules to the lease due-date's day-of-month, keeping
-- the same period month and clamping the day for short months. due_date is a
-- payment-classification field, so this never touches accounting entries.
update rental.pk_payment_schedules ps
set due_date = make_date(
      extract(year from ps.due_date)::int,
      extract(month from ps.due_date)::int,
      least(
        extract(day from l.due_date)::int,
        extract(day from (date_trunc('month', ps.due_date) + interval '1 month' - interval '1 day'))::int
      ))
from rental.pk_leases l
where l.id = ps.lease_id
  and l.due_date is not null
  and extract(day from ps.due_date) <> extract(day from l.due_date);

-- Sync each PK invoice's due_date to its (now corrected) schedule due_date.
-- Safe on posted invoices: due_date is not part of the journal entry.
update rental.pk_rent_invoices inv
set due_date = ps.due_date
from rental.pk_payment_schedules ps
where ps.id = inv.schedule_id and inv.due_date <> ps.due_date;
