-- =============================================================================
-- Sale Asset Voucher redesign: header + multi-line, account-driven.
--
-- Header carries one Customer (debit) account, an optional asset, narration,
-- Pak. Exch, currency and conversion. Each line credits a Fixed Asset
-- (Property) account for its gross. Posting debits the Customer account for the
-- total and credits each line's account — a straight disposal at gross, no
-- automatic gain/loss (the user drives the accounts).
--
-- No asset sales exist yet, so the old single-asset gain/loss columns are
-- removed rather than migrated.
-- =============================================================================

drop view if exists reporting.v_sale_report;

-- profit_loss_amount / capital_gain_amount are generated from sale_price, so
-- drop them before the columns they depend on.
alter table assets.asset_sales
  drop column if exists profit_loss_amount,
  drop column if exists capital_gain_amount,
  drop column if exists buyer,
  drop column if exists sale_price,
  drop column if exists book_value_at_sale,
  drop column if exists purchase_value_at_sale;

-- The sold asset is now an optional header reference.
alter table assets.asset_sales alter column asset_id drop not null;

alter table assets.asset_sales
  add column if not exists customer_account_id uuid references accounting.chart_of_accounts(id) on delete restrict,
  add column if not exists narration text,
  add column if not exists pak_exch numeric(18,4) not null default 0,
  add column if not exists total_value numeric(18,2) not null default 0;

create table assets.asset_sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references assets.asset_sales(id) on delete cascade,
  line_no int not null,
  fixed_asset_account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  gross numeric(18,2) not null check (gross >= 0),
  remarks text,
  created_at timestamptz not null default now(),
  constraint asset_sale_lines_unique unique (sale_id, line_no)
);

create index idx_asset_sale_lines_sale on assets.asset_sale_lines(sale_id);

alter table assets.asset_sale_lines enable row level security;

create policy asset_sale_lines_select on assets.asset_sale_lines
  for select using (
    sale_id in (select id from assets.asset_sales where company_id = core.current_company_id())
  );
create policy asset_sale_lines_insert on assets.asset_sale_lines
  for insert with check (
    sale_id in (
      select id from assets.asset_sales
      where company_id = core.current_company_id() and core.user_has_permission('asset_sales', 'create')
    )
  );

create trigger trg_audit_asset_sale_lines
  after insert or update or delete on assets.asset_sale_lines
  for each row execute function audit.fn_row_audit();

grant select, insert, update, delete on assets.asset_sale_lines to authenticated, service_role;

-- Report view — one row per sold-property line.
create view reporting.v_sale_report as
select s.company_id,
       s.id as sale_id,
       s.voucher_no,
       s.sale_date,
       coalesce(a.asset_code, '') as asset_code,
       coalesce(a.asset_name, fa.account_name) as asset_name,
       l.gross,
       cur.code as currency_code,
       je.status
from assets.asset_sales s
  join assets.asset_sale_lines l on l.sale_id = s.id
  join accounting.chart_of_accounts fa on fa.id = l.fixed_asset_account_id
  left join assets.assets a on a.id = s.asset_id
  join core.currencies cur on cur.id = s.currency_id
  join accounting.journal_entries je on je.id = s.journal_entry_id;

alter view reporting.v_sale_report set (security_invoker = on);
grant select on reporting.v_sale_report to authenticated, service_role;
