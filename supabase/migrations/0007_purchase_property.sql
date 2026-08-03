-- =============================================================================
-- Phase 7: Purchase Property
-- The first voucher type whose accounting treatment is fixed regardless of
-- transaction (always Dr the property's fixed-asset account, Cr supplier
-- payable) — posting_templates, unused since Phase 4, gets its first real
-- consumer and its first admin UI here.
--
-- Design note: the blueprint's assets.asset_purchases was meant as a
-- "business detail" table behind accounting.purchase_vouchers, but since
-- every field it would hold already lives on purchase_vouchers (same 1:1
-- relationship used for every Phase 5 voucher), a separate table would
-- just be a duplicate with nothing of its own — skipped for the same
-- reason Phase 5 didn't split its vouchers into header + detail tables.
-- =============================================================================

create table assets.suppliers (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  name             text not null,
  contact_person   text,
  phone            text,
  email            text,
  address          text,
  is_active        boolean not null default true,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz,
  deleted_by       uuid references auth.users(id),
  deleted_at       timestamptz,
  constraint suppliers_name_unique unique (company_id, name)
);

create trigger trg_suppliers_touch
  before update on assets.suppliers
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_suppliers after insert or update or delete on assets.suppliers
  for each row execute function audit.fn_row_audit();

create table accounting.purchase_vouchers (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references core.companies(id) on delete cascade,
  journal_entry_id       uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no             text,
  asset_id               uuid not null references assets.assets(id) on delete restrict,
  supplier_id            uuid not null references assets.suppliers(id) on delete restrict,
  purchase_date          date not null,
  currency_id            uuid not null references core.currencies(id) on delete restrict,
  exchange_rate          numeric(18,6) not null default 1 check (exchange_rate > 0),
  purchase_price         numeric(18,2) not null check (purchase_price >= 0),
  taxes                  numeric(18,2) not null default 0 check (taxes >= 0),
  registration_charges   numeric(18,2) not null default 0 check (registration_charges >= 0),
  additional_expenses    numeric(18,2) not null default 0 check (additional_expenses >= 0),
  total_amount           numeric(18,2) generated always as (purchase_price + taxes + registration_charges + additional_expenses) stored,
  created_by             uuid not null references auth.users(id),
  created_at             timestamptz not null default now(),
  constraint purchase_vouchers_no_unique unique (company_id, voucher_no)
);

create index idx_purchase_vouchers_asset on accounting.purchase_vouchers(asset_id);
create index idx_purchase_vouchers_supplier on accounting.purchase_vouchers(supplier_id);

create trigger trg_audit_purchase_vouchers after insert or update or delete on accounting.purchase_vouchers
  for each row execute function audit.fn_row_audit();

alter table accounting.purchase_vouchers enable row level security;

create policy purchase_vouchers_select on accounting.purchase_vouchers
  for select using (company_id = core.current_company_id());
create policy purchase_vouchers_insert on accounting.purchase_vouchers
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('purchase_voucher', 'create'));
create policy purchase_vouchers_update on accounting.purchase_vouchers
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('purchase_voucher', 'edit') or core.user_has_permission('purchase_voucher', 'post'))
  );

alter table assets.suppliers enable row level security;

create policy suppliers_select on assets.suppliers
  for select using (company_id = core.current_company_id() and deleted_at is null);
create policy suppliers_insert on assets.suppliers
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('purchase_voucher', 'create'));
create policy suppliers_update on assets.suppliers
  for update using (company_id = core.current_company_id() and core.user_has_permission('purchase_voucher', 'edit'));

comment on table assets.suppliers is
  'Gated by the purchase_voucher permission set rather than its own module — suppliers only exist to be picked on a Purchase Voucher, same rationale as tenants being gated by the rental modules in Phases 9/10.';

-- Extend the Voucher Register (Phase 5) to include Purchase Vouchers.
-- Every later voucher-type phase (9/10/11) re-runs this same
-- create-or-replace with its own table added to the join.
create or replace view accounting.v_voucher_register as
select je.company_id, je.voucher_type, je.voucher_id, je.entry_date,
       coalesce(rv.voucher_no, pv.voucher_no, ppv.voucher_no, prv.voucher_no,
                crv.voucher_no, jv.voucher_no, jvm.voucher_no, obv.voucher_no,
                purv.voucher_no) as voucher_no,
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
left join accounting.purchase_vouchers purv on purv.journal_entry_id = je.id;

alter view accounting.v_voucher_register set (security_invoker = on);
