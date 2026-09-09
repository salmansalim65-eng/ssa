-- A month a rent invoice is FOR, and a property that was empty in it.
--
-- HH is invoiced once a month for every property at once, so two facts the books
-- never held are worth holding: which month an invoice covers, and which
-- properties earned nothing in it.
--
-- Vacancy has to be RECORDED, not inferred. A property left off the invoice is
-- indistinguishable from one somebody forgot to enter, so a vacant property now
-- gets a line of its own — no rent, no posting, but a period on the record — and
-- the reports can then say "empty from this date to that date" and mean it.
--
-- `rent_month` already exists on the table (text, unused: NULL on every row) and
-- takes the same ISO first-of-month the voucher lines use.

alter table rental.uae_leases
  add column if not exists is_vacant boolean not null default false;

comment on column rental.uae_leases.is_vacant is
  'The property was empty for this period: no rent, no posting, recorded so the vacancy is a fact rather than an absence.';

comment on column rental.uae_leases.rent_month is
  'The month the invoice line is for, as the first of that month (YYYY-MM-01).';

-- Finding a month''s invoice, and a property''s vacant spells, without a scan.
create index if not exists idx_uae_leases_rent_month
  on rental.uae_leases (company_id, rent_month)
  where deleted_at is null;

-- A vacant line bills nothing, so it must not generate a payment schedule — a
-- zero-amount instalment would otherwise show up in the rent workings.
create or replace function rental.fn_generate_uae_payment_schedule()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_step_months int := case new.rent_cycle when 'monthly' then 1 else 12 end;
begin
  if new.is_vacant then
    return new;
  end if;
  insert into rental.uae_payment_schedules (lease_id, due_date, amount)
  select new.id, d, new.rental_amount
  from rental.fn_schedule_due_dates(coalesce(new.due_date, new.lease_start), new.lease_start, new.lease_end, v_step_months) as d;
  return new;
end;
$function$;
