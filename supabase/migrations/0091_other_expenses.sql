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

-- 3. Rebuild the rental income view with an `other_expenses` column.
create or replace view reporting.v_rental_income
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
  end as net_outstanding
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
  pri.outstanding_amount as net_outstanding
from rental.pk_rent_invoices pri
  join rental.pk_leases pl on pl.id = pri.lease_id
  join assets.assets a on a.id = pl.asset_id
  join rental.tenants t on t.id = pl.tenant_id
  join core.currencies cur on cur.id = pri.currency_id
  join accounting.journal_entries je on je.id = pri.journal_entry_id
where je.status = 'posted'::text;
