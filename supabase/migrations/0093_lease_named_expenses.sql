-- Named "Other Expenses" per HH lease property.
--
-- A UAE/HH lease previously carried a single monthly `expense_amount`. HH leases
-- can have SEVERAL named monthly expenses per property (e.g. Management, Chiller,
-- Maintenance), defined when the HH lease is created. Each becomes a row here,
-- keyed to the property's rental.uae_leases row.
--
-- Like the legacy single amount, these are a REPORTING deduction only: they
-- reduce the owner's Balance Rent in the Rent Balance report but are NOT
-- journalised on their own (the real cash outflow is booked via a Payment
-- Voucher, optionally tagged to the invoice). So the Rent Balance report's
-- Other Expenses column now sums three sources:
--   1. legacy single lease.expense_amount (kept, still counted)
--   2. named rental.lease_expenses rows (this migration)
--   3. payment-voucher lines tagged to the invoice (migration 0091)

create table if not exists rental.lease_expenses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references core.companies(id) on delete cascade,
  lease_id    uuid not null references rental.uae_leases(id) on delete cascade,
  name        text not null,
  amount      numeric(18, 2) not null default 0 check (amount >= 0),
  created_at  timestamptz not null default now()
);

create index if not exists idx_lease_expenses_lease on rental.lease_expenses(lease_id);
create index if not exists idx_lease_expenses_company on rental.lease_expenses(company_id);

alter table rental.lease_expenses enable row level security;

drop policy if exists lease_expenses_select on rental.lease_expenses;
create policy lease_expenses_select on rental.lease_expenses
  for select using (company_id = core.current_company_id());

drop policy if exists lease_expenses_insert on rental.lease_expenses;
create policy lease_expenses_insert on rental.lease_expenses
  for insert with check (company_id = core.current_company_id());

drop policy if exists lease_expenses_delete on rental.lease_expenses;
create policy lease_expenses_delete on rental.lease_expenses
  for delete using (company_id = core.current_company_id());

-- Rebuild the rental income view so UAE other_expenses also sums the named
-- lease_expenses. Shape/column names are unchanged (mirrors migration 0092).
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
      + coalesce((select sum(le.amount) from rental.lease_expenses le where le.lease_id = ul.id), 0)
      + coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.uae_invoice_id = uri.id), 0)
      as other_expenses,
    coalesce((select sum(ra.amount) from rental.receipt_invoice_allocations ra where ra.uae_invoice_id = uri.id), 0)
      as received
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
  other_expenses,
  (amount - agent_share - other_expenses) as net_amount,
  greatest(0, (amount - agent_share - other_expenses) - received) as net_outstanding,
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
  coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.pk_invoice_id = pri.id), 0) as other_expenses,
  (pri.total_amount
     - coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.pk_invoice_id = pri.id), 0)
  ) as net_amount,
  greatest(0,
    (pri.total_amount
       - coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.pk_invoice_id = pri.id), 0)
    )
    - coalesce((select sum(ra.amount) from rental.receipt_invoice_allocations ra where ra.pk_invoice_id = pri.id), 0)
  ) as net_outstanding,
  t.account_id as tenant_account_id
from rental.pk_rent_invoices pri
  join rental.pk_leases pl on pl.id = pri.lease_id
  join assets.assets a on a.id = pl.asset_id
  join rental.tenants t on t.id = pl.tenant_id
  join core.currencies cur on cur.id = pri.currency_id
  join accounting.journal_entries je on je.id = pri.journal_entry_id
where je.status = 'posted'::text;

create view reporting.v_outstanding_rent
with (security_invoker = on) as
select
  *,
  (current_date
     - (date_trunc('month', due_date) + interval '1 month' - interval '1 day')::date
  ) as days_overdue
from reporting.v_rental_income
where net_outstanding > 0;
