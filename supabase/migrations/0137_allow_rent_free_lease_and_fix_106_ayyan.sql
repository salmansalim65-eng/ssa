-- A let property can be RENT-FREE, and the books had no way to say so.
--
-- uae_leases.rental_amount was constrained to > 0, so a rent-free period could
-- only be recorded by typing something. 106 AYYAN was entered at AED 1 a month
-- to 14-04-2027 and billed AED 9 for the term — the property is occupied, just
-- not charged. (0136 read that 1 as a typo and scaled it to 3,500, which was
-- wrong in the other direction; this supersedes it.)
--
-- The constraint now allows 0. Rent-free is NOT vacant: the lease still runs, so
-- the property still reads as let everywhere — the renewal list, the occupancy
-- report, the rent report — and only its rent is nil.
--
-- A lease that charges nothing has nothing to bill, so its schedule and the
-- invoice raised from it go, along with the receipt allocation that had been put
-- against that invoice. The receipt keeps its full 42,029; 0.60 of it simply
-- sits unallocated, as an advance, which is what it always was.

alter table rental.uae_leases drop constraint if exists uae_leases_rental_amount_check;
alter table rental.uae_leases add constraint uae_leases_rental_amount_check check (rental_amount >= 0);

comment on column rental.uae_leases.rental_amount is
  'Rent per rent_cycle. Zero is allowed and means a rent-free letting: the property is occupied, nothing is charged. That is not the same as is_vacant, which means empty.';

-- Nothing to bill on a rent-free lease, so no payment schedule either.
create or replace function rental.fn_generate_uae_payment_schedule()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_step_months int := case new.rent_cycle when 'monthly' then 1 else 12 end;
begin
  if new.is_vacant or new.rental_amount = 0 then
    return new;
  end if;
  insert into rental.uae_payment_schedules (lease_id, due_date, amount)
  select new.id, d, new.rental_amount
  from rental.fn_schedule_due_dates(coalesce(new.due_date, new.lease_start), new.lease_start, new.lease_end, v_step_months) as d;
  return new;
end;
$function$;

do $$
declare
  v_lease uuid;
  v_inv   uuid;
  v_je    uuid;
begin
  select ul.id into v_lease
  from rental.uae_leases ul join assets.assets a on a.id = ul.asset_id
  where a.asset_name ilike '106 AYYAN' and ul.deleted_at is null and ul.lease_end = date '2027-04-14';
  if v_lease is null then
    raise notice '106 AYYAN lease not found - nothing to do';
    return;
  end if;

  update rental.uae_leases set rental_amount = 0, updated_at = now() where id = v_lease;
  delete from rental.uae_payment_schedules where lease_id = v_lease;

  select i.id, i.journal_entry_id into v_inv, v_je
  from rental.uae_rent_invoices i where i.lease_id = v_lease;
  if v_inv is null then
    raise notice 'Lease set rent-free; no invoice to remove';
    return;
  end if;

  delete from rental.receipt_invoice_allocations where uae_invoice_id = v_inv;
  delete from rental.uae_rent_invoices where id = v_inv;

  if v_je is not null then
    alter table accounting.journal_entry_lines disable trigger trg_prevent_posted_line_update;
    alter table accounting.journal_entries disable trigger trg_prevent_posted_entry_update;
    delete from accounting.journal_entry_lines where journal_entry_id = v_je;
    delete from accounting.journal_entries where id = v_je;
    alter table accounting.journal_entries enable trigger trg_prevent_posted_entry_update;
    alter table accounting.journal_entry_lines enable trigger trg_prevent_posted_line_update;
  end if;
end $$;
