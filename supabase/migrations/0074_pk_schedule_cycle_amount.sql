-- PK lease payment schedules (and the invoices generated from them) billed the
-- plain monthly_rent for every scheduled period, even when the rent cycle spans
-- several months. A quarterly lease at 181,500/month was billing 181,500 per
-- quarter instead of 181,500 x 3. Each scheduled period must bill the monthly
-- rent multiplied by the number of months it actually covers (monthly = 1,
-- quarterly = 3, yearly = 12), clamped so a short final period bills only the
-- months up to lease_end.
--
-- Both the INSERT trigger (fn_generate_pk_payment_schedule) and the edit RPC
-- (fn_update_pk_lease) are corrected. Downstream PK invoices read the schedule
-- amount, so fixing the schedule flows through to invoice generation.

-- Schedule generator: bill monthly_rent x months covered per period.
create or replace function rental.fn_generate_pk_payment_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due_date date;
  v_next date;
  v_step interval;
  v_months int;
begin
  v_step := case new.rent_cycle
              when 'quarterly' then interval '3 months'
              when 'yearly' then interval '1 year'
              else interval '1 month'
            end;
  v_due_date := new.lease_start;

  while v_due_date <= new.lease_end loop
    -- Exclusive end of this period, clamped to the day after lease_end so a
    -- short final period only bills the months it actually covers.
    v_next := least((v_due_date + v_step)::date, (new.lease_end + 1));
    v_months := greatest(1, (extract(year from age(v_next, v_due_date)) * 12
                             + extract(month from age(v_next, v_due_date)))::int);
    insert into rental.pk_payment_schedules (lease_id, due_date, amount)
    values (new.id, v_due_date, new.monthly_rent * v_months);
    v_due_date := (v_due_date + v_step)::date;
  end loop;

  return new;
end;
$$;

-- Edit RPC: same signature as 0071, schedule regeneration bills per-cycle months.
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
  v_due date;
  v_next date;
  v_step interval;
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

  v_step := case coalesce(p_rent_cycle, 'monthly')
              when 'quarterly' then interval '3 months'
              when 'yearly' then interval '1 year'
              else interval '1 month'
            end;
  v_due := p_lease_start;
  while v_due <= p_lease_end loop
    v_next := least((v_due + v_step)::date, (p_lease_end + 1));
    v_months := greatest(1, (extract(year from age(v_next, v_due)) * 12
                             + extract(month from age(v_next, v_due)))::int);
    insert into rental.pk_payment_schedules (lease_id, due_date, amount)
    values (p_lease_id, v_due, p_monthly_rent * v_months);
    v_due := (v_due + v_step)::date;
  end loop;
end;
$$;

grant execute on function rental.fn_update_pk_lease(uuid, uuid, uuid, date, date, numeric, numeric, numeric, uuid, date, text, numeric, text)
  to authenticated, service_role;
revoke execute on function rental.fn_update_pk_lease(uuid, uuid, uuid, date, date, numeric, numeric, numeric, uuid, date, text, numeric, text)
  from public, anon;

-- Backfill existing schedules that have NOT been invoiced yet (status 'pending'),
-- recomputing amount = monthly_rent x months covered. Invoiced / paid rows are
-- left untouched: their invoices (and any posted journal entries) already carry
-- the old amount, and correcting those is an accounting action (reverse and
-- regenerate), not a data patch.
with ordered as (
  select
    ps.id,
    ps.status,
    ps.due_date,
    l.monthly_rent,
    coalesce(
      lead(ps.due_date) over (partition by ps.lease_id order by ps.due_date),
      (l.lease_end + 1)
    ) as period_end
  from rental.pk_payment_schedules ps
  join rental.pk_leases l on l.id = ps.lease_id
)
update rental.pk_payment_schedules ps
set amount = o.monthly_rent * greatest(1,
      (extract(year from age(o.period_end, o.due_date)) * 12
       + extract(month from age(o.period_end, o.due_date)))::int)
from ordered o
where ps.id = o.id
  and o.status = 'pending';
