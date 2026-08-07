-- =============================================================================
-- Payment Voucher becomes a header + multi-line document (mirror of the Receipt
-- Voucher). The Cash/Bank account, date, due date, cost centre, currency and
-- conversion live on the header; each body line debits an Account for an amount,
-- with an optional rent month and remarks. Posting credits the Cash/Bank account
-- for the total and debits each line's account.
--
-- No payment vouchers exist yet, so the old single-line columns are just made
-- nullable (kept for history) rather than dropped.
-- =============================================================================

alter table accounting.payment_vouchers alter column paid_to drop not null;
alter table accounting.payment_vouchers alter column debit_account_id drop not null;
alter table accounting.payment_vouchers alter column amount drop not null;

alter table accounting.payment_vouchers add column if not exists due_date date;
alter table accounting.payment_vouchers
  add column if not exists cost_center_id uuid references accounting.cost_centers(id) on delete restrict;
alter table accounting.payment_vouchers add column if not exists total_amount numeric(18,2) not null default 0;

create table if not exists accounting.payment_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references accounting.payment_vouchers(id) on delete cascade,
  line_no smallint not null,
  account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  amount numeric(18,2) not null check (amount >= 0),
  rent_month date,
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_voucher_lines_voucher on accounting.payment_voucher_lines(voucher_id);

alter table accounting.payment_voucher_lines enable row level security;

create policy payment_voucher_lines_select on accounting.payment_voucher_lines
  for select using (
    exists (
      select 1 from accounting.payment_vouchers v
      where v.id = voucher_id and v.company_id = core.current_company_id()
    )
  );

create policy payment_voucher_lines_write on accounting.payment_voucher_lines
  for all using (
    exists (
      select 1 from accounting.payment_vouchers v
      where v.id = voucher_id
        and v.company_id = core.current_company_id()
        and (core.user_has_permission('payment_voucher', 'create') or core.user_has_permission('payment_voucher', 'edit'))
    )
  ) with check (
    exists (
      select 1 from accounting.payment_vouchers v
      where v.id = voucher_id
        and v.company_id = core.current_company_id()
        and (core.user_has_permission('payment_voucher', 'create') or core.user_has_permission('payment_voucher', 'edit'))
    )
  );

grant select, insert, update, delete on accounting.payment_voucher_lines to authenticated, service_role;

create trigger trg_audit_payment_voucher_lines after insert or update or delete on accounting.payment_voucher_lines
  for each row execute function audit.fn_row_audit();

select pg_notify('pgrst', 'reload schema');
