-- Combined pending migrations: run once in Supabase → SQL Editor.
-- Safe to re-run (idempotent: if-not-exists / drop-if-exists / create).

-- ============ 0090 ============
-- Receipt Voucher → rental invoice allocation.
--
-- A generic Receipt Voucher previously only posted a GL entry and never touched
-- the rental invoice it collected against, so a rent receipt left the invoice's
-- outstanding balance (and therefore the dashboard / reports) unchanged.
--
-- This migration lets a receipt line be "applied to" a specific rental invoice.
-- When the voucher is posted, an allocation row is written and a trigger reduces
-- that invoice's outstanding balance — mirroring the existing rent-payment flow
-- (rental.fn_apply_uae_rent_payment). Deleting the voucher cascades the
-- allocation away and the trigger restores the outstanding balance.

-- 1. Remember, on each receipt line, which rental invoice it is applied to.
alter table accounting.receipt_voucher_lines
  add column if not exists applied_country text
    check (applied_country in ('UAE', 'PK')),
  add column if not exists applied_uae_invoice_id uuid
    references rental.uae_rent_invoices(id) on delete set null,
  add column if not exists applied_pk_invoice_id uuid
    references rental.pk_rent_invoices(id) on delete set null;

-- 2. The allocations that actually move outstanding (written when a receipt posts).
create table if not exists rental.receipt_invoice_allocations (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  receipt_voucher_id uuid not null references accounting.receipt_vouchers(id) on delete cascade,
  receipt_line_id    uuid references accounting.receipt_voucher_lines(id) on delete cascade,
  country            text not null check (country in ('UAE', 'PK')),
  uae_invoice_id     uuid references rental.uae_rent_invoices(id) on delete cascade,
  pk_invoice_id      uuid references rental.pk_rent_invoices(id) on delete cascade,
  amount             numeric(18, 2) not null check (amount > 0),
  created_at         timestamptz not null default now(),
  constraint receipt_alloc_invoice_ck check (
    (country = 'UAE' and uae_invoice_id is not null and pk_invoice_id is null) or
    (country = 'PK'  and pk_invoice_id  is not null and uae_invoice_id is null)
  )
);

create index if not exists idx_receipt_alloc_voucher on rental.receipt_invoice_allocations(receipt_voucher_id);
create index if not exists idx_receipt_alloc_uae on rental.receipt_invoice_allocations(uae_invoice_id);
create index if not exists idx_receipt_alloc_pk on rental.receipt_invoice_allocations(pk_invoice_id);

-- 3. Trigger: apply the allocation to the invoice's outstanding balance.
create or replace function rental.fn_apply_receipt_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.country = 'UAE' then
      update rental.uae_rent_invoices
        set outstanding_balance = greatest(0, outstanding_balance - new.amount)
        where id = new.uae_invoice_id;
    else
      update rental.pk_rent_invoices
        set outstanding_amount = greatest(0, outstanding_amount - new.amount)
        where id = new.pk_invoice_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.country = 'UAE' then
      update rental.uae_rent_invoices
        set outstanding_balance = outstanding_balance + old.amount
        where id = old.uae_invoice_id;
    else
      update rental.pk_rent_invoices
        set outstanding_amount = outstanding_amount + old.amount
        where id = old.pk_invoice_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_apply_receipt_allocation on rental.receipt_invoice_allocations;
create trigger trg_apply_receipt_allocation
  after insert or delete on rental.receipt_invoice_allocations
  for each row execute function rental.fn_apply_receipt_allocation();

-- 4. RLS — company-scoped, same shape as the other rental tables.
alter table rental.receipt_invoice_allocations enable row level security;

drop policy if exists receipt_alloc_select on rental.receipt_invoice_allocations;
create policy receipt_alloc_select on rental.receipt_invoice_allocations
  for select using (company_id = core.current_company_id());

drop policy if exists receipt_alloc_insert on rental.receipt_invoice_allocations;
create policy receipt_alloc_insert on rental.receipt_invoice_allocations
  for insert with check (company_id = core.current_company_id());

drop policy if exists receipt_alloc_delete on rental.receipt_invoice_allocations;
create policy receipt_alloc_delete on rental.receipt_invoice_allocations
  for delete using (company_id = core.current_company_id());

-- ============ 0091 ============
-- "Other Expenses" against rental income.
--
-- Two sources feed a per-invoice "other expenses" figure that reduces the
-- owner's balance rent in the Rent Balance report:
--   1. A monthly expense set on a lease (entered per line on the HH lease form).
--   2. Payment vouchers whose lines are tagged to a specific rental invoice.
--
-- Balance Rent (report) = Rent - Management (agent share) - Other Expenses.
-- Other expenses are a reporting concept: they do NOT change the tenant's
-- outstanding balance, only the owner's realised rent.

-- 1. Monthly expense carried on a lease (0 for leases without one).
alter table rental.uae_leases
  add column if not exists expense_amount numeric(18, 2) not null default 0;

-- Payment voucher lines remember which rental invoice they are tagged to.
alter table accounting.payment_voucher_lines
  add column if not exists applied_country text
    check (applied_country in ('UAE', 'PK')),
  add column if not exists applied_uae_invoice_id uuid
    references rental.uae_rent_invoices(id) on delete set null,
  add column if not exists applied_pk_invoice_id uuid
    references rental.pk_rent_invoices(id) on delete set null;

-- 2. Payment voucher line -> rental invoice expense allocations.
create table if not exists rental.payment_invoice_expenses (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  payment_voucher_id uuid not null references accounting.payment_vouchers(id) on delete cascade,
  payment_line_id    uuid references accounting.payment_voucher_lines(id) on delete cascade,
  country            text not null check (country in ('UAE', 'PK')),
  uae_invoice_id     uuid references rental.uae_rent_invoices(id) on delete cascade,
  pk_invoice_id      uuid references rental.pk_rent_invoices(id) on delete cascade,
  amount             numeric(18, 2) not null check (amount > 0),
  created_at         timestamptz not null default now(),
  constraint payment_exp_invoice_ck check (
    (country = 'UAE' and uae_invoice_id is not null and pk_invoice_id is null) or
    (country = 'PK'  and pk_invoice_id  is not null and uae_invoice_id is null)
  )
);

create index if not exists idx_payment_exp_voucher on rental.payment_invoice_expenses(payment_voucher_id);
create index if not exists idx_payment_exp_uae on rental.payment_invoice_expenses(uae_invoice_id);
create index if not exists idx_payment_exp_pk on rental.payment_invoice_expenses(pk_invoice_id);

alter table rental.payment_invoice_expenses enable row level security;

drop policy if exists payment_exp_select on rental.payment_invoice_expenses;
create policy payment_exp_select on rental.payment_invoice_expenses
  for select using (company_id = core.current_company_id());

drop policy if exists payment_exp_insert on rental.payment_invoice_expenses;
create policy payment_exp_insert on rental.payment_invoice_expenses
  for insert with check (company_id = core.current_company_id());

drop policy if exists payment_exp_delete on rental.payment_invoice_expenses;
create policy payment_exp_delete on rental.payment_invoice_expenses
  for delete using (company_id = core.current_company_id());

-- 3. Rebuild the rental income view with `other_expenses` + `tenant_account_id`.
-- CREATE OR REPLACE can only append columns, and reporting.v_outstanding_rent
-- (which froze `select *` at its creation) depends on this view — so drop both
-- and recreate them, then rebuild v_outstanding_rent so its `*` picks up the new
-- columns too.
drop view if exists reporting.v_outstanding_rent;
drop view if exists reporting.v_rental_income;

create view reporting.v_rental_income
with (security_invoker = on) as
with uae as (
  select
    uri.company_id,
    'UAE'::text as country,
    uri.id as invoice_id,
    uri.voucher_no,
    a.asset_code,
    a.asset_name,
    t.name as tenant_name,
    uri.invoice_date,
    uri.due_date,
    uri.amount,
    uri.outstanding_balance,
    cur.code as currency_code,
    je.status,
    uri.exchange_rate,
    ul.lease_type,
    t.account_id as tenant_account_id,
    round(uri.amount * (case when ul.lease_type = 'hh' then 0.10 else 0.05 end), 2) as agent_share,
    coalesce(ul.expense_amount, 0)
      + coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.uae_invoice_id = uri.id), 0)
      as other_expenses
  from rental.uae_rent_invoices uri
    join rental.uae_leases ul on ul.id = uri.lease_id
    join assets.assets a on a.id = ul.asset_id
    join rental.tenants t on t.id = ul.tenant_id
    join core.currencies cur on cur.id = uri.currency_id
    join accounting.journal_entries je on je.id = uri.journal_entry_id
  where je.status = 'posted'::text
)
select
  company_id, country, invoice_id, voucher_no, asset_code, asset_name, tenant_name,
  invoice_date, due_date, amount, outstanding_balance, currency_code, status, exchange_rate,
  lease_type,
  agent_share,
  (amount - agent_share) as net_amount,
  other_expenses,
  case
    when amount > 0 then round(outstanding_balance * (amount - agent_share) / amount, 2)
    else outstanding_balance
  end as net_outstanding,
  tenant_account_id
from uae
union all
select
  pri.company_id,
  'PK'::text as country,
  pri.id as invoice_id,
  pri.voucher_no,
  a.asset_code,
  a.asset_name,
  t.name as tenant_name,
  pri.invoice_date,
  pri.due_date,
  pri.total_amount as amount,
  pri.outstanding_amount as outstanding_balance,
  cur.code as currency_code,
  je.status,
  pri.exchange_rate,
  null::text as lease_type,
  0::numeric as agent_share,
  pri.total_amount as net_amount,
  coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.pk_invoice_id = pri.id), 0) as other_expenses,
  pri.outstanding_amount as net_outstanding,
  t.account_id as tenant_account_id
from rental.pk_rent_invoices pri
  join rental.pk_leases pl on pl.id = pri.lease_id
  join assets.assets a on a.id = pl.asset_id
  join rental.tenants t on t.id = pl.tenant_id
  join core.currencies cur on cur.id = pri.currency_id
  join accounting.journal_entries je on je.id = pri.journal_entry_id
where je.status = 'posted'::text;

-- 4. Recreate the dependent outstanding-rent view (mirrors migration 0080) so its
-- `*` includes other_expenses + tenant_account_id.
create view reporting.v_outstanding_rent
with (security_invoker = on) as
select
  *,
  (current_date
     - (date_trunc('month', due_date) + interval '1 month' - interval '1 day')::date
  ) as days_overdue
from reporting.v_rental_income
where outstanding_balance > 0;
