-- Realised exchange gain / loss.
--
-- A foreign-currency account can be settled in its OWN currency and still carry
-- a balance in base currency, because the legs were translated at different
-- rates. KAMRAN SALEEM LOAN is the case that surfaced this: PKR 4,000,000 out on
-- 29 Aug at 77.50 and PKR 4,000,000 back on 31 Aug at 77.00 left SAR 336 sitting
-- on a loan that had been repaid in full.
--
-- That residue is a realised exchange gain (or loss), and it belongs in the P&L,
-- not on the loan. This migration gives the company an Exchange Gain/Loss
-- account and a function that moves the residue there as part of the entry that
-- settles the account, so the books carry it from the moment it is realised.

-- 1. Which account holds it. A flag rather than a name match, so renaming the
--    account in the Chart of Accounts does not break the posting.
alter table accounting.chart_of_accounts
  add column if not exists is_exchange_difference boolean not null default false;

create unique index if not exists chart_of_accounts_one_exchange_difference
  on accounting.chart_of_accounts (company_id)
  where is_exchange_difference and deleted_at is null;

-- 2. Create it for every company that has a base currency and does not have one
--    yet, under the company's top-level expense group. The code comes from the
--    same sequence the Chart of Accounts screen uses, so it fits the series.
do $$
declare
  c record;
  v_parent uuid;
  v_currency uuid;
  v_owner uuid;
  v_code text;
  v_seq core.document_sequences%rowtype;
begin
  for c in select id from core.companies loop
    if exists (
      select 1 from accounting.chart_of_accounts
      where company_id = c.id and is_exchange_difference and deleted_at is null
    ) then
      continue;
    end if;

    select currency_id into v_currency
    from core.company_currencies
    where company_id = c.id and is_base_currency and is_active
    limit 1;
    if v_currency is null then
      continue;
    end if;

    -- created_by is mandatory; attribute the account to whoever set the
    -- company's chart up, falling back to any member of the company.
    select created_by into v_owner
    from accounting.chart_of_accounts
    where company_id = c.id and created_by is not null
    order by created_at
    limit 1;
    if v_owner is null then
      select user_id into v_owner from core.user_roles where company_id = c.id limit 1;
    end if;
    if v_owner is null then
      continue;
    end if;

    select id into v_parent
    from accounting.chart_of_accounts
    where company_id = c.id and is_group and account_type = 'expense'
      and parent_id is null and deleted_at is null
    order by account_code
    limit 1;

    insert into core.document_sequences (company_id, voucher_type, prefix, padding)
    values (c.id, 'chart_of_accounts', 'AC', 6)
    on conflict (company_id, voucher_type) do nothing;

    select * into v_seq
    from core.document_sequences
    where company_id = c.id and voucher_type = 'chart_of_accounts'
    for update;

    v_code := v_seq.prefix || '-' || lpad(v_seq.next_number::text, v_seq.padding, '0');
    update core.document_sequences set next_number = next_number + 1 where id = v_seq.id;

    insert into accounting.chart_of_accounts (
      company_id, account_code, account_name, parent_id, account_type,
      currency_id, is_group, is_active, is_exchange_difference, created_by
    )
    values (
      c.id, v_code, 'Exchange Gain/Loss', v_parent, 'expense',
      v_currency, false, true, true, v_owner
    );
  end loop;
end $$;

-- 3. Move the residue as part of the settling entry.
--
-- Called just before an entry is posted, while its lines can still be written.
-- For every foreign-currency account the entry touches, it looks at that
-- account's balance across the posted ledger PLUS this entry: if the account is
-- now nil in its own currency but not in base, the leftover base amount is
-- written off to Exchange Gain/Loss.
--
-- The two lines it adds carry NO document amount — nothing more was received or
-- paid — only base amounts, which is exactly what an exchange difference is. The
-- pair is self-balancing in base, so the entry still posts.
--
-- It is deliberately quiet: with no base currency, no Exchange Gain/Loss account
-- or nothing to realise it returns 0 and the voucher posts as it always did.
create or replace function accounting.fn_realise_exchange_difference(p_journal_entry_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_status text;
  v_base_currency uuid;
  v_fx_account uuid;
  v_line int;
  v_added int := 0;
  r record;
begin
  select company_id, status into v_company, v_status
  from accounting.journal_entries where id = p_journal_entry_id;

  if v_company is null or v_status = 'posted' then
    return 0;
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;

  select currency_id into v_base_currency
  from core.company_currencies
  where company_id = v_company and is_base_currency and is_active
  limit 1;

  select id into v_fx_account
  from accounting.chart_of_accounts
  where company_id = v_company and is_exchange_difference and deleted_at is null
  limit 1;

  if v_base_currency is null or v_fx_account is null then
    return 0;
  end if;

  select coalesce(max(line_no), 0) into v_line
  from accounting.journal_entry_lines where journal_entry_id = p_journal_entry_id;

  for r in
    with touched as (
      select l.account_id, min(l.currency_id::text)::uuid as currency_id,
             min(l.exchange_rate) as exchange_rate
      from accounting.journal_entry_lines l
      where l.journal_entry_id = p_journal_entry_id
        and l.currency_id is not null
        and l.currency_id <> v_base_currency
        and l.account_id <> v_fx_account
      group by l.account_id
    ),
    bal as (
      select l.account_id,
             sum(l.debit_amount - l.credit_amount) as doc_net,
             sum(l.base_debit_amount - l.base_credit_amount) as base_net,
             count(distinct l.currency_id) as ncur
      from accounting.journal_entry_lines l
      join accounting.journal_entries je on je.id = l.journal_entry_id
      where je.company_id = v_company
        and (je.status = 'posted' or je.id = p_journal_entry_id)
        and l.account_id in (select account_id from touched)
      group by l.account_id
    )
    select t.account_id, t.currency_id, t.exchange_rate, b.base_net
    from touched t
    join bal b on b.account_id = t.account_id
    where b.ncur = 1
      and abs(b.doc_net) < 0.005
      and abs(b.base_net) >= 0.005
  loop
    -- Clear the residue on the settled account: base only, no document amount.
    v_line := v_line + 1;
    insert into accounting.journal_entry_lines (
      journal_entry_id, line_no, account_id, currency_id, exchange_rate,
      debit_amount, credit_amount, base_debit_amount, base_credit_amount, description
    )
    values (
      p_journal_entry_id, v_line, r.account_id, r.currency_id, r.exchange_rate,
      0, 0,
      case when r.base_net < 0 then -r.base_net else 0 end,
      case when r.base_net > 0 then r.base_net else 0 end,
      'Exchange difference on settlement'
    );

    -- The gain (credit) or loss (debit), in base currency.
    v_line := v_line + 1;
    insert into accounting.journal_entry_lines (
      journal_entry_id, line_no, account_id, currency_id, exchange_rate,
      debit_amount, credit_amount, base_debit_amount, base_credit_amount, description
    )
    values (
      p_journal_entry_id, v_line, v_fx_account, v_base_currency, 1,
      case when r.base_net > 0 then r.base_net else 0 end,
      case when r.base_net < 0 then -r.base_net else 0 end,
      case when r.base_net > 0 then r.base_net else 0 end,
      case when r.base_net < 0 then -r.base_net else 0 end,
      'Exchange difference on settlement'
    );

    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$function$;

grant execute on function accounting.fn_realise_exchange_difference(uuid) to authenticated;
