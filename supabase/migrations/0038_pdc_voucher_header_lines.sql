-- =============================================================================
-- PDC Payment and PDC Receipt vouchers become header + multi-line documents
-- (mirror of Payment / Receipt). The cheque (its PDC control account), cheque
-- no/date, counterparty, date, due date, cost centre, currency and conversion
-- live on the header; each body line is one Account + amount (+ optional rent
-- month, remarks).
--
-- PDC Payment: header credits the PDC liability; body lines debit their account.
-- PDC Receipt: header debits the PDC asset; body lines credit their account.
--
-- No PDC vouchers exist yet, so the moved single-line columns are just made
-- nullable rather than dropped.
-- =============================================================================

-- ---- PDC Payment: the debit (expense/payable) side moves to the body --------
alter table accounting.pdc_payment_vouchers alter column debit_account_id drop not null;
alter table accounting.pdc_payment_vouchers alter column amount drop not null;
alter table accounting.pdc_payment_vouchers add column if not exists due_date date;
alter table accounting.pdc_payment_vouchers
  add column if not exists cost_center_id uuid references accounting.cost_centers(id) on delete restrict;
alter table accounting.pdc_payment_vouchers add column if not exists total_amount numeric(18,2) not null default 0;

create table if not exists accounting.pdc_payment_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references accounting.pdc_payment_vouchers(id) on delete cascade,
  line_no smallint not null,
  account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  amount numeric(18,2) not null check (amount >= 0),
  rent_month date,
  remarks text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pdc_payment_voucher_lines_voucher on accounting.pdc_payment_voucher_lines(voucher_id);
alter table accounting.pdc_payment_voucher_lines enable row level security;

create policy pdc_payment_voucher_lines_select on accounting.pdc_payment_voucher_lines
  for select using (exists (
    select 1 from accounting.pdc_payment_vouchers v
    where v.id = voucher_id and v.company_id = core.current_company_id()));
create policy pdc_payment_voucher_lines_write on accounting.pdc_payment_voucher_lines
  for all using (exists (
    select 1 from accounting.pdc_payment_vouchers v
    where v.id = voucher_id and v.company_id = core.current_company_id()
      and (core.user_has_permission('pdc_payment_voucher','create') or core.user_has_permission('pdc_payment_voucher','edit'))))
  with check (exists (
    select 1 from accounting.pdc_payment_vouchers v
    where v.id = voucher_id and v.company_id = core.current_company_id()
      and (core.user_has_permission('pdc_payment_voucher','create') or core.user_has_permission('pdc_payment_voucher','edit'))));
grant select, insert, update, delete on accounting.pdc_payment_voucher_lines to authenticated, service_role;
create trigger trg_audit_pdc_payment_voucher_lines after insert or update or delete on accounting.pdc_payment_voucher_lines
  for each row execute function audit.fn_row_audit();

-- ---- PDC Receipt: the credit (income/receivable) side moves to the body ------
alter table accounting.pdc_receipt_vouchers alter column credit_account_id drop not null;
alter table accounting.pdc_receipt_vouchers alter column amount drop not null;
alter table accounting.pdc_receipt_vouchers add column if not exists due_date date;
alter table accounting.pdc_receipt_vouchers
  add column if not exists cost_center_id uuid references accounting.cost_centers(id) on delete restrict;
alter table accounting.pdc_receipt_vouchers add column if not exists total_amount numeric(18,2) not null default 0;

create table if not exists accounting.pdc_receipt_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references accounting.pdc_receipt_vouchers(id) on delete cascade,
  line_no smallint not null,
  account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  amount numeric(18,2) not null check (amount >= 0),
  rent_month date,
  remarks text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pdc_receipt_voucher_lines_voucher on accounting.pdc_receipt_voucher_lines(voucher_id);
alter table accounting.pdc_receipt_voucher_lines enable row level security;

create policy pdc_receipt_voucher_lines_select on accounting.pdc_receipt_voucher_lines
  for select using (exists (
    select 1 from accounting.pdc_receipt_vouchers v
    where v.id = voucher_id and v.company_id = core.current_company_id()));
create policy pdc_receipt_voucher_lines_write on accounting.pdc_receipt_voucher_lines
  for all using (exists (
    select 1 from accounting.pdc_receipt_vouchers v
    where v.id = voucher_id and v.company_id = core.current_company_id()
      and (core.user_has_permission('pdc_receipt_voucher','create') or core.user_has_permission('pdc_receipt_voucher','edit'))))
  with check (exists (
    select 1 from accounting.pdc_receipt_vouchers v
    where v.id = voucher_id and v.company_id = core.current_company_id()
      and (core.user_has_permission('pdc_receipt_voucher','create') or core.user_has_permission('pdc_receipt_voucher','edit'))));
grant select, insert, update, delete on accounting.pdc_receipt_voucher_lines to authenticated, service_role;
create trigger trg_audit_pdc_receipt_voucher_lines after insert or update or delete on accounting.pdc_receipt_voucher_lines
  for each row execute function audit.fn_row_audit();

select pg_notify('pgrst', 'reload schema');
