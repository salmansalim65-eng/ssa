-- =============================================================================
-- Phase 11: Asset Sale
-- Records the disposal of a registered asset: sale voucher (JE via the
-- Phase 4 posting engine), profit/loss against book value, and capital
-- gain against original purchase cost. All other cross-cutting pieces
-- (voucher_type enums, permission module) were already anticipated by
-- Phase 1 and Phase 4, so this migration only adds the table itself.
-- =============================================================================

create table assets.asset_sales (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references core.companies(id) on delete cascade,
  journal_entry_id        uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no              text,
  asset_id                uuid not null references assets.assets(id) on delete restrict,
  buyer                   text not null,
  sale_date               date not null,
  sale_price              numeric(18,2) not null check (sale_price > 0),
  -- Snapshots taken at sale time rather than joined live, since
  -- assets.current_value/purchase_value both remain user-editable after
  -- the sale — the sale record must keep the figures it was actually
  -- computed from.
  book_value_at_sale      numeric(18,2) not null check (book_value_at_sale >= 0),
  purchase_value_at_sale  numeric(18,2) not null check (purchase_value_at_sale >= 0),
  profit_loss_amount      numeric(18,2) generated always as (sale_price - book_value_at_sale) stored,
  capital_gain_amount     numeric(18,2) generated always as (sale_price - purchase_value_at_sale) stored,
  currency_id             uuid not null references core.currencies(id) on delete restrict,
  exchange_rate           numeric(18,6) not null default 1 check (exchange_rate > 0),
  created_by              uuid not null references auth.users(id),
  created_at              timestamptz not null default now(),
  constraint asset_sales_no_unique unique (company_id, voucher_no)
  -- Deliberately no unique(asset_id): a rejected sale must not permanently
  -- block re-selling the asset. The app layer refuses to create a new sale
  -- once assets.status = 'sold' (set only when a sale actually posts),
  -- same pattern as purchase_vouchers having no per-asset uniqueness.
);

create index idx_asset_sales_asset on assets.asset_sales(asset_id);

create trigger trg_audit_asset_sales after insert or update or delete on assets.asset_sales
  for each row execute function audit.fn_row_audit();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table assets.asset_sales enable row level security;

create policy asset_sales_select on assets.asset_sales
  for select using (company_id = core.current_company_id());
create policy asset_sales_insert on assets.asset_sales
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('asset_sales', 'create'));
create policy asset_sales_update on assets.asset_sales
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('asset_sales', 'edit') or core.user_has_permission('asset_sales', 'post'))
  );

-- -----------------------------------------------------------------------------
-- Extend the Voucher Register to include asset sales.
-- -----------------------------------------------------------------------------

create or replace view accounting.v_voucher_register as
select je.company_id, je.voucher_type, je.voucher_id, je.entry_date,
       coalesce(rv.voucher_no, pv.voucher_no, ppv.voucher_no, prv.voucher_no,
                crv.voucher_no, jv.voucher_no, jvm.voucher_no, obv.voucher_no,
                purv.voucher_no, uri.voucher_no, pri.voucher_no, asv.voucher_no) as voucher_no,
       je.currency_id, je.status, je.narration, je.created_by, je.created_at,
       je.posted_by, je.posted_at,
       (select coalesce(sum(base_debit_amount), 0) from accounting.journal_entry_lines l where l.journal_entry_id = je.id) as amount
from accounting.journal_entries je
left join accounting.receipt_vouchers rv on rv.journal_entry_id = je.id
left join accounting.payment_vouchers pv on pv.journal_entry_id = je.id
left join accounting.pdc_payment_vouchers ppv on ppv.journal_entry_id = je.id
left join accounting.pdc_receipt_vouchers prv on prv.journal_entry_id = je.id
left join accounting.cheque_return_vouchers crv on crv.journal_entry_id = je.id
left join accounting.journal_vouchers jv on jv.journal_entry_id = je.id
left join accounting.jv_maintenance_vouchers jvm on jvm.journal_entry_id = je.id
left join accounting.opening_balance_vouchers obv on obv.journal_entry_id = je.id
left join accounting.purchase_vouchers purv on purv.journal_entry_id = je.id
left join rental.uae_rent_invoices uri on uri.journal_entry_id = je.id
left join rental.pk_rent_invoices pri on pri.journal_entry_id = je.id
left join assets.asset_sales asv on asv.journal_entry_id = je.id;

alter view accounting.v_voucher_register set (security_invoker = on);
