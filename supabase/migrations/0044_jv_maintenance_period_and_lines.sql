-- JV Maintenance gains a billing period and its own line table shaped as
-- Cost Center / Debit Account / Credit Account / Amount. Each row expands into
-- a balanced debit+credit pair of journal_entry_lines at create/post time.
alter table accounting.jv_maintenance_vouchers
  add column if not exists period_from date,
  add column if not exists period_till date;

create table if not exists accounting.jv_maintenance_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references accounting.jv_maintenance_vouchers(id) on delete cascade,
  line_no smallint not null,
  cost_center_id uuid references accounting.cost_centers(id) on delete restrict,
  debit_account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  credit_account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  amount numeric not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (voucher_id, line_no)
);

alter table accounting.jv_maintenance_voucher_lines enable row level security;

create policy jv_maintenance_voucher_lines_select on accounting.jv_maintenance_voucher_lines
  for select using (
    exists (
      select 1 from accounting.jv_maintenance_vouchers v
      where v.id = jv_maintenance_voucher_lines.voucher_id
        and v.company_id = core.current_company_id()
    )
  );

create policy jv_maintenance_voucher_lines_write on accounting.jv_maintenance_voucher_lines
  for all using (
    exists (
      select 1 from accounting.jv_maintenance_vouchers v
      where v.id = jv_maintenance_voucher_lines.voucher_id
        and v.company_id = core.current_company_id()
        and (core.user_has_permission('jv_maintenance_voucher', 'create')
             or core.user_has_permission('jv_maintenance_voucher', 'edit'))
    )
  ) with check (
    exists (
      select 1 from accounting.jv_maintenance_vouchers v
      where v.id = jv_maintenance_voucher_lines.voucher_id
        and v.company_id = core.current_company_id()
        and (core.user_has_permission('jv_maintenance_voucher', 'create')
             or core.user_has_permission('jv_maintenance_voucher', 'edit'))
    )
  );

grant select, insert, update, delete on accounting.jv_maintenance_voucher_lines to authenticated;
