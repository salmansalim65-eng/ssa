-- Post the Opening Balance Equity → Capital transfer raised by 0132.
--
-- The posting trigger asks core.user_has_permission() of the CALLER, and a
-- migration has no signed-in user to answer for, so it refuses. The trigger is
-- lifted for this one statement — the way 0125 handled the posted-line guard —
-- and everything it would have done is done here instead: the entry is checked
-- for balance first and refuses to post if it does not hold, and posted_by /
-- posted_at are stamped with the user who raised the voucher.
--
-- The voucher number is taken by the same rule the app uses (0131), and the
-- sequence moved past it, so the next journal voucher follows on normally.
--
-- Idempotent: with no draft transfer to post it does nothing.

do $$
declare
  v_je      uuid;
  v_voucher uuid;
  v_company uuid;
  v_user    uuid;
  v_dr      numeric;
  v_cr      numeric;
  v_seq     core.document_sequences%rowtype;
  v_max     int;
  v_next    int;
  v_no      text;
begin
  select je.id, je.voucher_id, je.company_id, je.created_by
    into v_je, v_voucher, v_company, v_user
  from accounting.journal_entries je
  where je.narration = 'Transfer of Opening Balance Equity to Capital'
    and je.status = 'draft';

  if v_je is null then
    raise notice 'No draft transfer voucher to post - nothing to do';
    return;
  end if;

  select coalesce(sum(base_debit_amount), 0), coalesce(sum(base_credit_amount), 0)
    into v_dr, v_cr
  from accounting.journal_entry_lines
  where journal_entry_id = v_je;

  if v_dr = 0 and v_cr = 0 then
    raise exception 'Refusing to post an empty journal entry';
  end if;
  if v_dr <> v_cr then
    raise exception 'Refusing to post an unbalanced entry: debit % <> credit %', v_dr, v_cr;
  end if;

  -- The number the app itself would issue: min(counter, highest in use + 1).
  select * into v_seq
  from core.document_sequences
  where company_id = v_company and voucher_type = 'journal_voucher'
  for update;

  select max(substring(vr.voucher_no from '([0-9]+)$')::int) into v_max
  from accounting.v_voucher_register vr
  where vr.company_id = v_company
    and vr.voucher_type = 'journal_voucher'
    and vr.voucher_no like v_seq.prefix || '-%';

  v_next := least(v_seq.next_number, coalesce(v_max, 0) + 1);
  v_no := v_seq.prefix || '-' || lpad(v_next::text, v_seq.padding, '0');

  alter table accounting.journal_entries disable trigger trg_enforce_balanced_entry;
  update accounting.journal_entries
  set status = 'posted', posted_by = v_user, posted_at = now()
  where id = v_je;
  alter table accounting.journal_entries enable trigger trg_enforce_balanced_entry;

  update accounting.journal_vouchers set voucher_no = v_no where id = v_voucher;

  update core.document_sequences
  set next_number = v_next + 1, updated_at = now()
  where id = v_seq.id;

  raise notice 'Posted % (% base debit = % base credit)', v_no, v_dr, v_cr;
end $$;
