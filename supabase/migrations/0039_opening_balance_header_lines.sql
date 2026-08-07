-- =============================================================================
-- Opening Balance Voucher becomes a header + multi-line document. The contra
-- (Opening Balance Equity) account, as-of date, cost centre, currency and
-- conversion live on the header; each body line sets one Account's opening
-- balance as a Debit or a Credit. Posting books every line and lets the contra
-- account absorb the net so the entry balances.
--
-- No opening-balance vouchers exist yet, so the single-account columns are just
-- made nullable rather than dropped.
-- =============================================================================

alter table accounting.opening_balance_vouchers alter column account_id drop not null;
alter table accounting.opening_balance_vouchers alter column debit_amount drop not null;
alter table accounting.opening_balance_vouchers alter column credit_amount drop not null;
-- The old "exactly one of debit/credit on the header" rule no longer applies —
-- amounts live on the lines now.
alter table accounting.opening_balance_vouchers drop constraint if exists opening_balance_one_side;

alter table accounting.opening_balance_vouchers add column if not exists due_date date;
alter table accounting.opening_balance_vouchers
  add column if not exists cost_center_id uuid references accounting.cost_centers(id) on delete restrict;
alter table accounting.opening_balance_vouchers add column if not exists narration text;
alter table accounting.opening_balance_vouchers add column if not exists total_amount numeric(18,2) not null default 0;

create table if not exists accounting.opening_balance_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references accounting.opening_balance_vouchers(id) on delete cascade,
  line_no smallint not null,
  account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  debit numeric(18,2) not null default 0 check (debit >= 0),
  credit numeric(18,2) not null default 0 check (credit >= 0),
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists idx_opening_balance_voucher_lines_voucher on accounting.opening_balance_voucher_lines(voucher_id);

alter table accounting.opening_balance_voucher_lines enable row level security;

create policy opening_balance_voucher_lines_select on accounting.opening_balance_voucher_lines
  for select using (exists (
    select 1 from accounting.opening_balance_vouchers v
    where v.id = voucher_id and v.company_id = core.current_company_id()));
create policy opening_balance_voucher_lines_write on accounting.opening_balance_voucher_lines
  for all using (exists (
    select 1 from accounting.opening_balance_vouchers v
    where v.id = voucher_id and v.company_id = core.current_company_id()
      and (core.user_has_permission('opening_balance_voucher','create') or core.user_has_permission('opening_balance_voucher','edit'))))
  with check (exists (
    select 1 from accounting.opening_balance_vouchers v
    where v.id = voucher_id and v.company_id = core.current_company_id()
      and (core.user_has_permission('opening_balance_voucher','create') or core.user_has_permission('opening_balance_voucher','edit'))));
grant select, insert, update, delete on accounting.opening_balance_voucher_lines to authenticated, service_role;

create trigger trg_audit_opening_balance_voucher_lines after insert or update or delete on accounting.opening_balance_voucher_lines
  for each row execute function audit.fn_row_audit();

select pg_notify('pgrst', 'reload schema');
