-- Pending fix: run once in Supabase → SQL Editor. Safe to re-run.
-- ============================================================================
-- Journal Voucher → rental invoice adjustment (bidirectional)
-- A Journal Voucher can now be applied to a rental invoice like the Receipt /
-- PDC Receipt adjustment, but bidirectional: because a JV line has both a debit
-- and a credit account and the tenant can be on either side —
--   * tenant DEBITED  (billing)    → INCREASE that invoice's outstanding
--   * tenant CREDITED (collection) → DECREASE that invoice's outstanding
-- This is what lets a JV like "JULY RENT BALANCE" (Dr Tenant / Cr Rent Income)
-- raise the tenant's outstanding so a later Receipt voucher can collect against
-- it (the Receipt adjustment reads reporting.v_outstanding_rent).
-- ============================================================================
create table if not exists rental.journal_invoice_allocations (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  journal_voucher_id uuid not null references accounting.journal_vouchers(id) on delete cascade,
  journal_line_id    uuid references accounting.journal_voucher_lines(id) on delete cascade,
  country            text not null check (country in ('UAE', 'PK')),
  uae_invoice_id     uuid references rental.uae_rent_invoices(id) on delete cascade,
  pk_invoice_id      uuid references rental.pk_rent_invoices(id) on delete cascade,
  direction          text not null check (direction in ('increase', 'decrease')),
  amount             numeric(18, 2) not null check (amount > 0),
  created_at         timestamptz not null default now(),
  constraint journal_alloc_invoice_ck check (
    (country = 'UAE' and uae_invoice_id is not null and pk_invoice_id is null) or
    (country = 'PK'  and pk_invoice_id  is not null and uae_invoice_id is null)
  )
);

create index if not exists idx_journal_alloc_voucher on rental.journal_invoice_allocations(journal_voucher_id);
create index if not exists idx_journal_alloc_uae on rental.journal_invoice_allocations(uae_invoice_id);
create index if not exists idx_journal_alloc_pk on rental.journal_invoice_allocations(pk_invoice_id);

-- Trigger: move the invoice's outstanding balance by the signed amount. Billing
-- (increase) raises it; collection (decrease) lowers it. Delete reverses.
create or replace function rental.fn_apply_journal_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta numeric;
begin
  if tg_op = 'INSERT' then
    v_delta := case when new.direction = 'increase' then new.amount else -new.amount end;
    if new.country = 'UAE' then
      update rental.uae_rent_invoices
        set outstanding_balance = greatest(0, outstanding_balance + v_delta)
        where id = new.uae_invoice_id;
    else
      update rental.pk_rent_invoices
        set outstanding_amount = greatest(0, outstanding_amount + v_delta)
        where id = new.pk_invoice_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    v_delta := case when old.direction = 'increase' then old.amount else -old.amount end;
    if old.country = 'UAE' then
      update rental.uae_rent_invoices
        set outstanding_balance = greatest(0, outstanding_balance - v_delta)
        where id = old.uae_invoice_id;
    else
      update rental.pk_rent_invoices
        set outstanding_amount = greatest(0, outstanding_amount - v_delta)
        where id = old.pk_invoice_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_apply_journal_allocation on rental.journal_invoice_allocations;
create trigger trg_apply_journal_allocation
  after insert or delete on rental.journal_invoice_allocations
  for each row execute function rental.fn_apply_journal_allocation();

-- RLS — company-scoped, same shape as the other rental allocation tables.
alter table rental.journal_invoice_allocations enable row level security;

drop policy if exists journal_alloc_select on rental.journal_invoice_allocations;
create policy journal_alloc_select on rental.journal_invoice_allocations
  for select using (company_id = core.current_company_id());

drop policy if exists journal_alloc_insert on rental.journal_invoice_allocations;
create policy journal_alloc_insert on rental.journal_invoice_allocations
  for insert with check (company_id = core.current_company_id());

drop policy if exists journal_alloc_delete on rental.journal_invoice_allocations;
create policy journal_alloc_delete on rental.journal_invoice_allocations
  for delete using (company_id = core.current_company_id());

grant select, insert, update, delete on rental.journal_invoice_allocations to authenticated;

-- ============================================================================
-- Make Journal Voucher bill adjustments visible in outstanding rent.
-- v_outstanding_rent computes net_outstanding from the invoice minus receipt
-- allocations and never reads journal_invoice_allocations, so a JV that bills a
-- tenant never surfaced on a Receipt voucher. Fold the JV allocations in as a
-- signed term (increase raises, decrease lowers). Mirrors migration 0093.
-- ============================================================================
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
      as received,
    coalesce((select sum(case when ja.direction = 'increase' then ja.amount else -ja.amount end)
              from rental.journal_invoice_allocations ja where ja.uae_invoice_id = uri.id), 0)
      as jv_adjustment
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
  greatest(0, (amount - agent_share - other_expenses) + jv_adjustment - received) as net_outstanding,
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
    + coalesce((select sum(case when ja.direction = 'increase' then ja.amount else -ja.amount end)
                from rental.journal_invoice_allocations ja where ja.pk_invoice_id = pri.id), 0)
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
