-- =============================================================================
-- Purchase Voucher redesign: a header + multi-line asset document.
--
-- The voucher header carries one Vendor (credit) account, supplier, narration,
-- payment terms, share %, currency and a computed total. Each asset is a line
-- with its own Fixed Asset (debit) account, gross amount, due date, installment
-- month and remarks. Posting debits each line's account and credits the vendor
-- account for the total.
--
-- No purchase vouchers exist yet, so the old single-asset / component-price
-- columns are removed rather than migrated.
-- =============================================================================

-- The report view depends on the columns being dropped; recreate it after.
drop view if exists reporting.v_purchase_report;

alter table accounting.purchase_vouchers
  drop column if exists total_amount,
  drop column if exists purchase_price,
  drop column if exists taxes,
  drop column if exists registration_charges,
  drop column if exists additional_expenses,
  drop column if exists asset_id;

alter table accounting.purchase_vouchers
  add column if not exists vendor_account_id uuid references accounting.chart_of_accounts(id) on delete restrict,
  add column if not exists narration text,
  add column if not exists payment_terms text,
  add column if not exists share_percentage numeric(9,4) not null default 0,
  add column if not exists total_value numeric(18,2) not null default 0;

create table accounting.purchase_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references accounting.purchase_vouchers(id) on delete cascade,
  line_no int not null,
  asset_id uuid not null references assets.assets(id) on delete restrict,
  fixed_asset_account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  gross numeric(18,2) not null check (gross >= 0),
  due_date date,
  installment_month text,
  remarks text,
  created_at timestamptz not null default now(),
  constraint purchase_voucher_lines_unique unique (voucher_id, line_no)
);

create index idx_purchase_voucher_lines_voucher on accounting.purchase_voucher_lines(voucher_id);

alter table accounting.purchase_voucher_lines enable row level security;

create policy purchase_voucher_lines_select on accounting.purchase_voucher_lines
  for select using (
    voucher_id in (select id from accounting.purchase_vouchers where company_id = core.current_company_id())
  );
create policy purchase_voucher_lines_insert on accounting.purchase_voucher_lines
  for insert with check (
    voucher_id in (
      select id from accounting.purchase_vouchers
      where company_id = core.current_company_id() and core.user_has_permission('purchase_voucher', 'create')
    )
  );

create trigger trg_audit_purchase_voucher_lines
  after insert or update or delete on accounting.purchase_voucher_lines
  for each row execute function audit.fn_row_audit();

grant select, insert, update, delete on accounting.purchase_voucher_lines to authenticated, service_role;

-- Report view — one row per purchased asset line.
create view reporting.v_purchase_report as
select pv.company_id,
       pv.id as purchase_voucher_id,
       pv.voucher_no,
       pv.purchase_date,
       a.asset_code,
       a.asset_name,
       s.name as supplier_name,
       l.gross,
       cur.code as currency_code,
       je.status
from accounting.purchase_vouchers pv
  join accounting.purchase_voucher_lines l on l.voucher_id = pv.id
  join assets.assets a on a.id = l.asset_id
  join assets.suppliers s on s.id = pv.supplier_id
  join core.currencies cur on cur.id = pv.currency_id
  join accounting.journal_entries je on je.id = pv.journal_entry_id;

alter view reporting.v_purchase_report set (security_invoker = on);
grant select on reporting.v_purchase_report to authenticated, service_role;
