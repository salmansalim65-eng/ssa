-- Raise a journal voucher moving what is left in Opening Balance Equity into
-- CAPITAL. One-off, for these books.
--
-- Opening Balance Equity is a holding account: every opening balance is credited
-- there while the books are being set up. Now that they are complete the balance
-- belongs in CAPITAL, which is what the owner actually put in.
--
-- The transfer is split ONE PAIR PER COST CENTRE rather than posted as a lump. A
-- cost-centre-wise balance sheet balances per cost centre, and a lump would
-- credit CAPITAL somewhere the debit never came from, unbalancing every property
-- it touched. Cost centres already netting to zero are skipped.
--
-- The voucher is left as a DRAFT on purpose. Posting checks the poster's own
-- permission and stamps them as posted_by, which a migration cannot stand in
-- for, so it is raised here and posted in the app by a person.
--
-- Idempotent and environment-safe: it does nothing at all where the two accounts
-- do not exist, where the holding account is already clear, or where this
-- voucher has been raised before.

do $$
declare
  v_company uuid;
  v_user    uuid;
  v_currency uuid;
  v_rate    numeric;
  v_obe     uuid;
  v_capital uuid;
  v_je      uuid := gen_random_uuid();
  v_voucher uuid := gen_random_uuid();
  v_date    date := current_date;
  v_line    smallint := 0;
  v_dr      numeric := 0;
  v_cr      numeric := 0;
  r         record;
begin
  select id into v_obe
  from accounting.chart_of_accounts
  where account_name ilike 'Opening Balance Equity' and deleted_at is null
  limit 1;

  select id into v_capital
  from accounting.chart_of_accounts
  where account_name ilike 'CAPITAL' and account_type = 'equity' and not is_group and deleted_at is null
  limit 1;

  if v_obe is null or v_capital is null then
    raise notice 'Opening Balance Equity or CAPITAL not found - nothing to do';
    return;
  end if;

  -- Raised once. A second run would double the transfer.
  if exists (
    select 1 from accounting.journal_entries
    where narration = 'Transfer of Opening Balance Equity to Capital'
  ) then
    raise notice 'Transfer voucher already raised - nothing to do';
    return;
  end if;

  select je.company_id, je.created_by, l.currency_id, l.exchange_rate
    into v_company, v_user, v_currency, v_rate
  from accounting.journal_entry_lines l
  join accounting.journal_entries je on je.id = l.journal_entry_id
  where l.account_id = v_obe and je.status = 'posted'
  order by je.created_at desc
  limit 1;

  if v_company is null then
    raise notice 'Opening Balance Equity carries no posted lines - nothing to do';
    return;
  end if;

  insert into accounting.journal_entries
    (id, company_id, entry_date, voucher_type, voucher_id, currency_id, exchange_rate,
     narration, status, created_by, created_at)
  values
    (v_je, v_company, v_date, 'journal_voucher', v_voucher, v_currency, v_rate,
     'Transfer of Opening Balance Equity to Capital', 'draft', v_user, now());

  -- voucher_no stays NULL: the app assigns it when the voucher is posted.
  insert into accounting.journal_vouchers
    (id, company_id, journal_entry_id, entry_date, narration, created_by, created_at)
  values
    (v_voucher, v_company, v_je, v_date,
     'Transfer of Opening Balance Equity to Capital', v_user, now());

  for r in
    select l.cost_center_id,
           sum(l.credit_amount - l.debit_amount)           as doc_amount,
           sum(l.base_credit_amount - l.base_debit_amount) as base_amount
    from accounting.journal_entry_lines l
    join accounting.journal_entries je on je.id = l.journal_entry_id
    where l.account_id = v_obe
      and je.status = 'posted'
      and je.company_id = v_company
    group by l.cost_center_id
    having sum(l.base_credit_amount - l.base_debit_amount) <> 0
    order by l.cost_center_id
  loop
    -- Dr Opening Balance Equity — clearing the holding account.
    v_line := v_line + 1;
    insert into accounting.journal_entry_lines
      (id, journal_entry_id, line_no, account_id, cost_center_id,
       debit_amount, credit_amount, currency_id, exchange_rate,
       base_debit_amount, base_credit_amount, description)
    values
      (gen_random_uuid(), v_je, v_line, v_obe, r.cost_center_id,
       r.doc_amount, 0, v_currency, v_rate, r.base_amount, 0,
       'Opening balance equity transferred to capital');

    -- Cr CAPITAL — same cost centre, so the property stays balanced.
    v_line := v_line + 1;
    insert into accounting.journal_entry_lines
      (id, journal_entry_id, line_no, account_id, cost_center_id,
       debit_amount, credit_amount, currency_id, exchange_rate,
       base_debit_amount, base_credit_amount, description)
    values
      (gen_random_uuid(), v_je, v_line, v_capital, r.cost_center_id,
       0, r.doc_amount, v_currency, v_rate, 0, r.base_amount,
       'Opening balance equity transferred to capital');

    insert into accounting.journal_voucher_lines
      (id, voucher_id, line_no, cost_center_id, debit_account_id, credit_account_id, amount, remarks, created_at)
    values
      (gen_random_uuid(), v_voucher, (v_line / 2)::smallint, r.cost_center_id, v_obe, v_capital, r.doc_amount,
       'Opening balance equity transferred to capital', now());

    v_dr := v_dr + r.base_amount;
    v_cr := v_cr + r.base_amount;
  end loop;

  if v_line = 0 then
    raise exception 'Opening Balance Equity is already clear - nothing to transfer';
  end if;

  -- The posting trigger cannot check this until the voucher is posted, so check
  -- it here: an unbalanced draft must never be left behind.
  if v_dr <> v_cr then
    raise exception 'Transfer is not balanced: debit % <> credit %', v_dr, v_cr;
  end if;
end $$;
