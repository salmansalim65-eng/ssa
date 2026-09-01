-- Settle a Journal Voucher's party-account balance from a Receipt / Payment.
--
-- A JV can post a Dr or Cr straight to a party account (e.g. Dr UHF SOLUTIONS /
-- Cr RENT INCOME) that is not tied to any rental invoice — leaving an open
-- receivable/payable on that account's ledger. Users want to collect/pay that
-- balance later through a Receipt or Payment voucher and "adjust" it there.
--
-- Each such JV line becomes an OPEN ITEM: for its debit account it is a
-- receivable (settled by a Receipt that credits the account); for its credit
-- account a payable (settled by a Payment that debits the account). A settlement
-- row records how much of a JV line has been applied; the remaining balance is
-- derived (JV line amount − settled). No GL is posted here — the Receipt /
-- Payment already books the real cash movement; this is open-item matching only.

create table if not exists accounting.jv_open_item_settlements (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  journal_line_id    uuid not null references accounting.journal_voucher_lines(id) on delete cascade,
  account_id         uuid not null references accounting.chart_of_accounts(id),
  side               text not null check (side in ('debit', 'credit')),
  receipt_voucher_id uuid references accounting.receipt_vouchers(id) on delete cascade,
  receipt_line_id    uuid references accounting.receipt_voucher_lines(id) on delete cascade,
  payment_voucher_id uuid references accounting.payment_vouchers(id) on delete cascade,
  payment_line_id    uuid references accounting.payment_voucher_lines(id) on delete cascade,
  amount             numeric(18, 2) not null check (amount > 0),
  created_at         timestamptz not null default now(),
  -- Exactly one settling voucher (a receipt or a payment) owns each settlement.
  constraint jv_settle_one_source check (num_nonnulls(receipt_voucher_id, payment_voucher_id) = 1)
);

create index if not exists idx_jv_settle_line on accounting.jv_open_item_settlements(journal_line_id);
create index if not exists idx_jv_settle_account on accounting.jv_open_item_settlements(account_id);
create index if not exists idx_jv_settle_receipt on accounting.jv_open_item_settlements(receipt_voucher_id);
create index if not exists idx_jv_settle_payment on accounting.jv_open_item_settlements(payment_voucher_id);

alter table accounting.jv_open_item_settlements enable row level security;

drop policy if exists jv_settle_select on accounting.jv_open_item_settlements;
create policy jv_settle_select on accounting.jv_open_item_settlements
  for select using (company_id = core.current_company_id());

drop policy if exists jv_settle_insert on accounting.jv_open_item_settlements;
create policy jv_settle_insert on accounting.jv_open_item_settlements
  for insert with check (company_id = core.current_company_id());

drop policy if exists jv_settle_delete on accounting.jv_open_item_settlements;
create policy jv_settle_delete on accounting.jv_open_item_settlements
  for delete using (company_id = core.current_company_id());

grant select, insert, update, delete on accounting.jv_open_item_settlements to authenticated;

-- Open JV ledger items with their remaining (unsettled) balance. Each posted JV
-- line yields two rows: its debit account (receivable) and its credit account
-- (payable). The app filters by account + side + remaining > 0.
drop view if exists accounting.v_open_jv_items;
create view accounting.v_open_jv_items
with (security_invoker = on) as
with lines as (
  select
    jvl.id as journal_line_id,
    jv.id as voucher_id,
    jv.company_id,
    jv.voucher_no,
    jv.entry_date,
    jv.narration,
    jvl.debit_account_id as account_id,
    'debit'::text as side,
    jvl.amount
  from accounting.journal_voucher_lines jvl
    join accounting.journal_vouchers jv on jv.id = jvl.voucher_id
    join accounting.journal_entries je on je.id = jv.journal_entry_id
  where je.status = 'posted'::text
  union all
  select
    jvl.id,
    jv.id,
    jv.company_id,
    jv.voucher_no,
    jv.entry_date,
    jv.narration,
    jvl.credit_account_id,
    'credit'::text,
    jvl.amount
  from accounting.journal_voucher_lines jvl
    join accounting.journal_vouchers jv on jv.id = jvl.voucher_id
    join accounting.journal_entries je on je.id = jv.journal_entry_id
  where je.status = 'posted'::text
)
select
  l.journal_line_id,
  l.voucher_id,
  l.company_id,
  l.voucher_no,
  l.entry_date,
  l.narration,
  l.account_id,
  l.side,
  l.amount,
  l.amount - coalesce((
    select sum(s.amount) from accounting.jv_open_item_settlements s
    where s.journal_line_id = l.journal_line_id and s.side = l.side
  ), 0) as remaining
from lines l;

grant select on accounting.v_open_jv_items to authenticated;
