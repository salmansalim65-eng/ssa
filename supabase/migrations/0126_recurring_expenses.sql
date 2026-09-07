-- Recurring expenses, and liabilities that are not due back soon.
--
-- The Cash Flow Forecast could only see money that was already invoiced or
-- already written as a cheque. The running costs — salaries, DEWA, service
-- charges, a tax instalment — are real commitments that fall due on a known day
-- every month, but the app held them nowhere, so nothing deducted them and the
-- "safe to withdraw" figure read high.
--
-- These are a PLANNING schedule, not vouchers: they say what is expected to go
-- out and when. Posting the actual expense stays a Payment Voucher like any
-- other; nothing here touches the ledger.

create table if not exists accounting.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies(id) on delete cascade,
  name text not null,
  account_id uuid references accounting.chart_of_accounts(id) on delete set null,
  cost_center_id uuid references accounting.cost_centers(id) on delete set null,
  currency_id uuid not null references core.currencies(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  -- How often it falls due, and on which day of the month.
  frequency text not null default 'monthly'
    check (frequency in ('monthly', 'quarterly', 'half_yearly', 'yearly')),
  day_of_month smallint not null default 1 check (day_of_month between 1 and 31),
  -- The first month it is due, and the last (null = until further notice).
  start_date date not null,
  end_date date,
  notes text,
  is_active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz,
  deleted_by uuid,
  deleted_at timestamptz
);

create index if not exists recurring_expenses_company_idx
  on accounting.recurring_expenses (company_id) where deleted_at is null;

alter table accounting.recurring_expenses enable row level security;

drop policy if exists recurring_expenses_select on accounting.recurring_expenses;
create policy recurring_expenses_select on accounting.recurring_expenses
  for select using (company_id = core.current_company_id() and deleted_at is null);

drop policy if exists recurring_expenses_insert on accounting.recurring_expenses;
create policy recurring_expenses_insert on accounting.recurring_expenses
  for insert with check (
    company_id = core.current_company_id()
    and core.user_has_permission('recurring_expenses', 'create')
  );

drop policy if exists recurring_expenses_update on accounting.recurring_expenses;
create policy recurring_expenses_update on accounting.recurring_expenses
  for update using (
    company_id = core.current_company_id()
    and (
      core.user_has_permission('recurring_expenses', 'edit')
      or core.user_has_permission('recurring_expenses', 'delete')
    )
  );

grant select, insert, update on accounting.recurring_expenses to authenticated;

-- The permission catalogue entry, with the same nine actions every module has.
insert into core.permissions (module_key, action, label)
select 'recurring_expenses', a.action, a.label
from (values
  ('view', 'View recurring expenses'),
  ('create', 'Create recurring expenses'),
  ('edit', 'Edit recurring expenses'),
  ('delete', 'Delete recurring expenses'),
  ('approve', 'Approve recurring expenses'),
  ('reject', 'Reject recurring expenses'),
  ('post', 'Post recurring expenses'),
  ('print', 'Print recurring expenses'),
  ('export', 'Export recurring expenses')
) as a(action, label)
where not exists (
  select 1 from core.permissions p
  where p.module_key = 'recurring_expenses' and p.action = a.action
);

-- A liability the company will not settle any time soon — a long-term loan, a
-- deposit held for years. The forecast's "safe to withdraw" deducts what is
-- owed out, but deducting a liability that is not going anywhere understates
-- the headroom, so each account says for itself.
alter table accounting.chart_of_accounts
  add column if not exists is_long_term boolean not null default false;
