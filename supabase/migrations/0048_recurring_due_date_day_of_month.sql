-- Recurring rent due dates keep the lease due-date's DAY-OF-MONTH each period
-- (20th -> 20th every month), instead of stepping from lease_start. Occurrences
-- are computed from the anchor month (non-iterative) so they never drift, and
-- the day is clamped to the month's last day for short months (e.g. 31 -> 28/30).
-- Existing schedules are untouched; only newly created / edited leases regenerate.

create or replace function rental.fn_schedule_due_dates(
  p_anchor date, p_start date, p_end date, p_step_months int
)
returns setof date
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_day int := extract(day from p_anchor)::int;
  v_i int := 0;
  v_m date;
  v_last int;
  v_due date;
begin
  loop
    v_m := (date_trunc('month', p_anchor) + ((v_i * p_step_months) || ' months')::interval)::date;
    v_last := extract(day from (date_trunc('month', v_m) + interval '1 month' - interval '1 day'))::int;
    v_due := make_date(extract(year from v_m)::int, extract(month from v_m)::int, least(v_day, v_last));
    exit when v_due > p_end;
    if v_due >= p_start then
      return next v_due;
    end if;
    v_i := v_i + 1;
    exit when v_i > 6000;
  end loop;
end;
$function$;

create or replace function rental.fn_generate_uae_payment_schedule()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_step_months int := case new.rent_cycle when 'monthly' then 1 else 12 end;
begin
  insert into rental.uae_payment_schedules (lease_id, due_date, amount)
  select new.id, d, new.rental_amount
  from rental.fn_schedule_due_dates(coalesce(new.due_date, new.lease_start), new.lease_start, new.lease_end, v_step_months) as d;
  return new;
end;
$function$;

create or replace function rental.fn_generate_pk_payment_schedule()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into rental.pk_payment_schedules (lease_id, due_date, amount)
  select new.id, d, new.monthly_rent
  from rental.fn_schedule_due_dates(coalesce(new.due_date, new.lease_start), new.lease_start, new.lease_end, 1) as d;
  return new;
end;
$function$;

create or replace function rental.fn_update_uae_lease(
  p_lease_id uuid, p_asset_id uuid, p_tenant_id uuid, p_lease_start date, p_lease_end date,
  p_rental_amount numeric, p_rent_cycle text, p_security_deposit numeric, p_currency_id uuid,
  p_due_date date, p_rent_month text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_company uuid; v_inv_ids uuid[]; v_je_ids uuid[];
begin
  select company_id into v_company from rental.uae_leases where id = p_lease_id and deleted_at is null;
  if v_company is null then raise exception 'Lease not found'; end if;
  if core.current_company_id() is distinct from v_company then raise exception 'Not authorized for this company'; end if;
  if not core.user_has_permission('uae_rent_invoice', 'edit') then raise exception 'Not authorized to edit this lease'; end if;
  if exists (select 1 from rental.uae_rent_invoices i join accounting.journal_entries je on je.id = i.journal_entry_id
             where i.lease_id = p_lease_id and je.status = 'posted') then
    raise exception 'This lease has posted invoices and can no longer be edited; reverse them first';
  end if;
  select array_agg(id), array_agg(journal_entry_id) into v_inv_ids, v_je_ids
    from rental.uae_rent_invoices where lease_id = p_lease_id;
  if v_inv_ids is not null then
    delete from rental.uae_rent_payments where invoice_id = any(v_inv_ids);
    delete from accounting.voucher_approvals where voucher_type = 'uae_rent_invoice' and voucher_id = any(v_inv_ids);
    delete from rental.uae_rent_invoices where lease_id = p_lease_id;
    delete from accounting.journal_entry_lines where journal_entry_id = any(v_je_ids);
    delete from accounting.journal_entries where id = any(v_je_ids);
  end if;
  delete from rental.uae_payment_schedules where lease_id = p_lease_id;
  update rental.uae_leases set asset_id = p_asset_id, tenant_id = p_tenant_id, lease_start = p_lease_start,
    lease_end = p_lease_end, rental_amount = p_rental_amount, rent_cycle = p_rent_cycle,
    security_deposit = p_security_deposit, currency_id = p_currency_id, due_date = p_due_date, rent_month = p_rent_month
  where id = p_lease_id;
  insert into rental.uae_payment_schedules (lease_id, due_date, amount)
  select p_lease_id, d, p_rental_amount
  from rental.fn_schedule_due_dates(coalesce(p_due_date, p_lease_start), p_lease_start, p_lease_end,
       case p_rent_cycle when 'monthly' then 1 else 12 end) as d;
end;
$function$;

create or replace function rental.fn_update_pk_lease(
  p_lease_id uuid, p_asset_id uuid, p_tenant_id uuid, p_lease_start date, p_lease_end date,
  p_monthly_rent numeric, p_advance_rent numeric, p_security_deposit numeric, p_currency_id uuid,
  p_due_date date, p_rent_month text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_company uuid; v_inv_ids uuid[]; v_je_ids uuid[];
begin
  select company_id into v_company from rental.pk_leases where id = p_lease_id and deleted_at is null;
  if v_company is null then raise exception 'Lease not found'; end if;
  if core.current_company_id() is distinct from v_company then raise exception 'Not authorized for this company'; end if;
  if not core.user_has_permission('pk_rent_invoice', 'edit') then raise exception 'Not authorized to edit this lease'; end if;
  if exists (select 1 from rental.pk_rent_invoices i join accounting.journal_entries je on je.id = i.journal_entry_id
             where i.lease_id = p_lease_id and je.status = 'posted') then
    raise exception 'This lease has posted invoices and can no longer be edited; reverse them first';
  end if;
  select array_agg(id), array_agg(journal_entry_id) into v_inv_ids, v_je_ids
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
  update rental.pk_leases set asset_id = p_asset_id, tenant_id = p_tenant_id, lease_start = p_lease_start,
    lease_end = p_lease_end, monthly_rent = p_monthly_rent, advance_rent = p_advance_rent,
    security_deposit = p_security_deposit, currency_id = p_currency_id, due_date = p_due_date, rent_month = p_rent_month
  where id = p_lease_id;
  insert into rental.pk_payment_schedules (lease_id, due_date, amount)
  select p_lease_id, d, p_monthly_rent
  from rental.fn_schedule_due_dates(coalesce(p_due_date, p_lease_start), p_lease_start, p_lease_end, 1) as d;
end;
$function$;
