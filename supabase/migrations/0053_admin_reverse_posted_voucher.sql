-- Administrators can "delete" a POSTED voucher or invoice. Because posted rows
-- are immutable ledger history (fn_prevent_posted_entry_changes), a physical
-- delete would corrupt the accounting trail. Instead this posts a REVERSING
-- journal entry (debits/credits swapped) so the net ledger effect is zero, and
-- links it to the original via reversal_of. The reversal itself is a posted
-- entry, so the audit trigger records the whole operation. Re-doable downstream
-- state (a sold asset, an invoiced rent schedule) is reopened.

alter table accounting.journal_entries
  add column if not exists reversal_of uuid references accounting.journal_entries(id) on delete set null;

create or replace function accounting.fn_admin_reverse_voucher(p_journal_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig accounting.journal_entries%rowtype;
  v_new_id uuid := gen_random_uuid();
begin
  if not core.is_admin() then
    raise exception 'Only administrators can delete posted documents';
  end if;

  select * into v_orig from accounting.journal_entries where id = p_journal_entry_id;
  if not found then
    raise exception 'Voucher not found';
  end if;
  if v_orig.company_id <> core.current_company_id() then
    raise exception 'Voucher is not in the active company';
  end if;
  if v_orig.status <> 'posted' then
    raise exception 'Only posted documents can be reversed';
  end if;
  if v_orig.reversal_of is not null then
    raise exception 'A reversal entry cannot itself be reversed';
  end if;
  if exists (select 1 from accounting.journal_entries where reversal_of = p_journal_entry_id) then
    raise exception 'This document has already been reversed';
  end if;

  -- Reversing header. A fresh voucher_id keeps the (voucher_type, voucher_id)
  -- unique index happy; reversal_of ties it back to the original.
  insert into accounting.journal_entries (
    id, company_id, entry_date, voucher_type, voucher_id, currency_id, exchange_rate,
    narration, status, created_by, posted_by, posted_at, reversal_of
  ) values (
    v_new_id, v_orig.company_id, v_orig.entry_date, v_orig.voucher_type, gen_random_uuid(),
    v_orig.currency_id, v_orig.exchange_rate,
    'Reversal of ' || coalesce(
      (select vr.voucher_no from accounting.v_voucher_register vr
        where vr.company_id = v_orig.company_id
          and vr.voucher_type = v_orig.voucher_type
          and vr.voucher_id = v_orig.voucher_id),
      'posted document'),
    'posted', auth.uid(), auth.uid(), now(), p_journal_entry_id
  );

  -- Reversing lines: swap debit/credit (and their base amounts).
  insert into accounting.journal_entry_lines (
    journal_entry_id, line_no, account_id, cost_center_id,
    debit_amount, credit_amount, currency_id, exchange_rate,
    base_debit_amount, base_credit_amount, description, reference
  )
  select v_new_id, line_no, account_id, cost_center_id,
    credit_amount, debit_amount, currency_id, exchange_rate,
    base_credit_amount, base_debit_amount, 'Reversal', reference
  from accounting.journal_entry_lines
  where journal_entry_id = p_journal_entry_id;

  -- Reopen re-doable downstream state so the document can be re-created.
  if v_orig.voucher_type = 'asset_sales' then
    update assets.assets a set status = 'active'
    where a.id = (select s.asset_id from assets.asset_sales s where s.journal_entry_id = p_journal_entry_id)
      and a.status = 'sold';
  elsif v_orig.voucher_type = 'uae_rent_invoice' then
    update rental.uae_payment_schedules ps set status = 'pending'
    where ps.id = (select i.schedule_id from rental.uae_rent_invoices i where i.journal_entry_id = p_journal_entry_id);
  elsif v_orig.voucher_type = 'pk_rent_invoice' then
    update rental.pk_payment_schedules ps set status = 'pending'
    where ps.id = (select i.schedule_id from rental.pk_rent_invoices i where i.journal_entry_id = p_journal_entry_id);
  end if;

  return v_new_id;
end;
$$;

grant execute on function accounting.fn_admin_reverse_voucher(uuid) to authenticated;
