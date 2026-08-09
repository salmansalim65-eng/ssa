-- The normal Journal Voucher body is restructured to Cost Center / Debit
-- Account / Credit Account / Amount (matching JV Maintenance). Each row expands
-- into a balanced debit+credit pair of journal_entry_lines at create/post time;
-- this table preserves the per-row shape for edit/copy/detail round-trips.
create table if not exists accounting.journal_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references accounting.journal_vouchers(id) on delete cascade,
  line_no smallint not null,
  cost_center_id uuid references accounting.cost_centers(id) on delete restrict,
  debit_account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  credit_account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  amount numeric not null check (amount >= 0),
  remarks text,
  created_at timestamptz not null default now(),
  unique (voucher_id, line_no)
);

alter table accounting.journal_voucher_lines enable row level security;

create policy journal_voucher_lines_select on accounting.journal_voucher_lines
  for select using (
    exists (
      select 1 from accounting.journal_vouchers v
      where v.id = journal_voucher_lines.voucher_id
        and v.company_id = core.current_company_id()
    )
  );

create policy journal_voucher_lines_write on accounting.journal_voucher_lines
  for all using (
    exists (
      select 1 from accounting.journal_vouchers v
      where v.id = journal_voucher_lines.voucher_id
        and v.company_id = core.current_company_id()
        and (core.user_has_permission('journal_voucher', 'create')
             or core.user_has_permission('journal_voucher', 'edit'))
    )
  ) with check (
    exists (
      select 1 from accounting.journal_vouchers v
      where v.id = journal_voucher_lines.voucher_id
        and v.company_id = core.current_company_id()
        and (core.user_has_permission('journal_voucher', 'create')
             or core.user_has_permission('journal_voucher', 'edit'))
    )
  );

grant select, insert, update, delete on accounting.journal_voucher_lines to authenticated;

-- JV Maintenance: Period From / Period Till move to per-row (after Amount) and a
-- per-row Remarks is added. The header period columns on jv_maintenance_vouchers
-- are left in place (nullable, no longer written) for backward compatibility.
alter table accounting.jv_maintenance_voucher_lines
  add column if not exists period_from date,
  add column if not exists period_till date,
  add column if not exists remarks text;
