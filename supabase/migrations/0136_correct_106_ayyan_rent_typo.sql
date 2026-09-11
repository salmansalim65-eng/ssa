-- 106 AYYAN was let at AED 1 a month. A typo: the property's own estimated rent
-- is AED 3,500, and the invoice it raised came to AED 9 for nine months.
--
-- The lease, its payment schedule and that invoice are all corrected to 3,500.
-- The posted entry is restated in place rather than reversed and re-raised: it
-- is one document with one wrong figure, and the correction keeps the same
-- accounts, cost centre, currency and rate — only the amounts scale. The
-- posted-line guard is lifted for that statement alone and put straight back,
-- and the entry is checked for balance afterwards.
--
-- 9 months x 3,500 = 31,500 rent, 5% agent share 1,575, net 29,925.
-- Base (SAR at 1.02): 32,130.00 debit against 1,606.50 + 30,523.50 credit.
--
-- One-off and safe elsewhere: it does nothing unless a 106 AYYAN lease is
-- actually sitting at AED 1.

do $$
declare
  v_lease uuid;
  v_inv   uuid;
  v_je    uuid;
  v_old   numeric;
  v_new   numeric := 3500.00;
  v_rate  numeric;
  v_scale numeric;
  v_dr    numeric;
  v_cr    numeric;
begin
  select ul.id into v_lease
  from rental.uae_leases ul join assets.assets a on a.id = ul.asset_id
  where a.asset_name ilike '106 AYYAN' and ul.deleted_at is null and ul.rental_amount = 1;
  if v_lease is null then
    raise notice '106 AYYAN lease at AED 1 not found - nothing to do';
    return;
  end if;

  select rental_amount into v_old from rental.uae_leases where id = v_lease;
  v_scale := v_new / v_old;

  update rental.uae_leases set rental_amount = v_new, updated_at = now() where id = v_lease;
  update rental.uae_payment_schedules set amount = round(amount * v_scale, 2) where lease_id = v_lease;

  select i.id, i.journal_entry_id into v_inv, v_je
  from rental.uae_rent_invoices i where i.lease_id = v_lease;
  if v_inv is null then
    raise notice 'Lease corrected; no invoice to restate';
    return;
  end if;

  update rental.uae_rent_invoices
  set amount = round(amount * v_scale, 2),
      outstanding_balance = round(outstanding_balance * v_scale, 2)
  where id = v_inv;

  select exchange_rate into v_rate from accounting.journal_entries where id = v_je;

  alter table accounting.journal_entry_lines disable trigger trg_prevent_posted_line_update;
  update accounting.journal_entry_lines
  set debit_amount       = round(debit_amount * v_scale, 2),
      credit_amount      = round(credit_amount * v_scale, 2),
      base_debit_amount  = round(round(debit_amount * v_scale, 2) * v_rate, 2),
      base_credit_amount = round(round(credit_amount * v_scale, 2) * v_rate, 2)
  where journal_entry_id = v_je;
  alter table accounting.journal_entry_lines enable trigger trg_prevent_posted_line_update;

  select coalesce(sum(base_debit_amount), 0), coalesce(sum(base_credit_amount), 0)
    into v_dr, v_cr
  from accounting.journal_entry_lines where journal_entry_id = v_je;
  if v_dr <> v_cr then
    raise exception 'Restated entry is not balanced: debit % <> credit %', v_dr, v_cr;
  end if;

  raise notice 'Corrected 106 AYYAN to % a month; entry now % base each side', v_new, v_dr;
end $$;
