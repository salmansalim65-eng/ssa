-- Pakistan leases gain two fields:
--   * official_rent — the officially declared rent, recorded alongside the actual
--     monthly_rent that drives billing (informational).
--   * rent_cycle — how often rent falls due: monthly, quarterly or yearly. Like
--     the UAE lease's cycle, it sets the spacing of the generated payment
--     schedule; each generated period still bills the per-period `monthly_rent`.
alter table rental.pk_leases
  add column if not exists official_rent numeric(18,2),
  add column if not exists rent_cycle text not null default 'monthly'
    check (rent_cycle in ('monthly', 'quarterly', 'yearly'));

-- Schedule generator now steps by the lease's cycle instead of a fixed month.
create or replace function rental.fn_generate_pk_payment_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due_date date;
  v_step interval;
begin
  v_step := case new.rent_cycle
              when 'quarterly' then interval '3 months'
              when 'yearly' then interval '1 year'
              else interval '1 month'
            end;
  v_due_date := new.lease_start;

  while v_due_date <= new.lease_end loop
    insert into rental.pk_payment_schedules (lease_id, due_date, amount)
    values (new.id, v_due_date, new.monthly_rent);
    v_due_date := (v_due_date + v_step)::date;
  end loop;

  return new;
end;
$$;

-- The update RPC gains p_official_rent and p_rent_cycle and steps by the cycle.
drop function if exists rental.fn_update_pk_lease(uuid, uuid, uuid, date, date, numeric, numeric, numeric, uuid, date, text);

create function rental.fn_update_pk_lease(
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
  v_step interval;
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
    insert into rental.pk_payment_schedules (lease_id, due_date, amount) values (p_lease_id, v_due, p_monthly_rent);
    v_due := (v_due + v_step)::date;
  end loop;
end;
$$;

grant execute on function rental.fn_update_pk_lease(uuid, uuid, uuid, date, date, numeric, numeric, numeric, uuid, date, text, numeric, text)
  to authenticated, service_role;
revoke execute on function rental.fn_update_pk_lease(uuid, uuid, uuid, date, date, numeric, numeric, numeric, uuid, date, text, numeric, text)
  from public, anon;
