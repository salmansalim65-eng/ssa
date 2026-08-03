-- =============================================================================
-- Phase 9: UAE Rental Management
-- Tenants (shared with Pakistan rentals in Phase 10), UAE leases, the
-- payment schedule a lease generates, and rent invoices that post through
-- the same journal engine every other voucher uses.
-- =============================================================================

create schema if not exists rental;

insert into core.permissions (module_key, action, label)
select 'tenants', a.action, initcap(a.action) || ' tenants'
from (values ('view'),('create'),('edit'),('delete'),('print'),('export'),('approve'),('reject'),('post')) as a(action)
on conflict (module_key, action) do nothing;

create table rental.tenants (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  name             text not null,
  id_number        text,
  phone            text,
  email            text,
  address          text,
  is_active        boolean not null default true,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz,
  deleted_by       uuid references auth.users(id),
  deleted_at       timestamptz
);

comment on column rental.tenants.id_number is
  'CNIC for Pakistan tenants, Emirates ID for UAE tenants — one free-text column rather than two, since a tenant only ever needs the one that matches their lease''s country.';

create trigger trg_tenants_touch
  before update on rental.tenants
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_tenants after insert or update or delete on rental.tenants
  for each row execute function audit.fn_row_audit();

-- -----------------------------------------------------------------------------
-- UAE leases + auto-generated payment schedule
-- -----------------------------------------------------------------------------

create table rental.uae_leases (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  asset_id          uuid not null references assets.assets(id) on delete restrict,
  tenant_id         uuid not null references rental.tenants(id) on delete restrict,
  lease_start       date not null,
  lease_end         date not null,
  rental_amount     numeric(18,2) not null check (rental_amount > 0),
  rent_cycle        text not null check (rent_cycle in ('monthly','yearly')),
  security_deposit  numeric(18,2) not null default 0 check (security_deposit >= 0),
  currency_id       uuid not null references core.currencies(id) on delete restrict,
  status            text not null default 'active' check (status in ('active','expired','terminated')),
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id),
  updated_at        timestamptz,
  deleted_by        uuid references auth.users(id),
  deleted_at        timestamptz,
  constraint uae_leases_dates check (lease_end > lease_start)
);

create index idx_uae_leases_asset on rental.uae_leases(asset_id);
create index idx_uae_leases_tenant on rental.uae_leases(tenant_id);

create trigger trg_uae_leases_touch
  before update on rental.uae_leases
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_uae_leases after insert or update or delete on rental.uae_leases
  for each row execute function audit.fn_row_audit();

create table rental.uae_payment_schedules (
  id          uuid primary key default gen_random_uuid(),
  lease_id    uuid not null references rental.uae_leases(id) on delete cascade,
  due_date    date not null,
  amount      numeric(18,2) not null check (amount > 0),
  status      text not null default 'pending' check (status in ('pending','invoiced','paid','overdue')),
  created_at  timestamptz not null default now(),
  constraint uae_payment_schedules_unique unique (lease_id, due_date)
);

create index idx_uae_payment_schedules_lease on rental.uae_payment_schedules(lease_id, due_date);

create trigger trg_audit_uae_payment_schedules after insert or update or delete on rental.uae_payment_schedules
  for each row execute function audit.fn_row_audit();

-- One schedule row per rent cycle period from lease_start to lease_end,
-- generated once when the lease is created — this is what the invoice
-- generation screen reads from to know what's due.
create or replace function rental.fn_generate_uae_payment_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step interval;
  v_due_date date;
begin
  v_step := case new.rent_cycle when 'monthly' then interval '1 month' else interval '1 year' end;
  v_due_date := new.lease_start;

  while v_due_date <= new.lease_end loop
    insert into rental.uae_payment_schedules (lease_id, due_date, amount)
    values (new.id, v_due_date, new.rental_amount);
    v_due_date := (v_due_date + v_step)::date;
  end loop;

  return new;
end;
$$;

create trigger trg_generate_uae_payment_schedule
  after insert on rental.uae_leases
  for each row execute function rental.fn_generate_uae_payment_schedule();

-- -----------------------------------------------------------------------------
-- UAE rent invoices — post through the same journal engine as every other
-- voucher (Dr Tenant Receivable / Cr Rental Income, via posting_templates
-- since that mapping is always the same regardless of transaction).
-- -----------------------------------------------------------------------------

create table rental.uae_rent_invoices (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  journal_entry_id    uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no          text,
  lease_id            uuid not null references rental.uae_leases(id) on delete restrict,
  schedule_id         uuid references rental.uae_payment_schedules(id) on delete set null,
  invoice_date        date not null,
  due_date            date not null,
  period_start        date not null,
  period_end          date not null,
  amount              numeric(18,2) not null check (amount > 0),
  currency_id         uuid not null references core.currencies(id) on delete restrict,
  exchange_rate       numeric(18,6) not null default 1 check (exchange_rate > 0),
  outstanding_balance numeric(18,2) not null check (outstanding_balance >= 0),
  created_by          uuid not null references auth.users(id),
  created_at          timestamptz not null default now(),
  constraint uae_rent_invoices_no_unique unique (company_id, voucher_no)
);

create index idx_uae_rent_invoices_lease on rental.uae_rent_invoices(lease_id);

create trigger trg_audit_uae_rent_invoices after insert or update or delete on rental.uae_rent_invoices
  for each row execute function audit.fn_row_audit();

-- Marks the schedule entry this invoice was generated from so it drops out
-- of "due for invoicing" lists.
create or replace function rental.fn_mark_schedule_invoiced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.schedule_id is not null then
    update rental.uae_payment_schedules set status = 'invoiced' where id = new.schedule_id;
  end if;
  return new;
end;
$$;

create trigger trg_mark_schedule_invoiced
  after insert on rental.uae_rent_invoices
  for each row execute function rental.fn_mark_schedule_invoiced();

-- Records money received against a specific invoice. Deliberately its own
-- small table + simple 2-line JE (Dr Cash/Bank, Cr Tenant Receivable)
-- rather than retrofitting Phase 5's generic Receipt Voucher, which has no
-- notion of "against this invoice" — see the app-layer action for why.
create table rental.uae_rent_payments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  invoice_id          uuid not null references rental.uae_rent_invoices(id) on delete restrict,
  journal_entry_id    uuid not null references accounting.journal_entries(id) on delete restrict,
  payment_date        date not null,
  amount              numeric(18,2) not null check (amount > 0),
  cash_bank_account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  created_by          uuid not null references auth.users(id),
  created_at          timestamptz not null default now()
);

create index idx_uae_rent_payments_invoice on rental.uae_rent_payments(invoice_id);

create trigger trg_audit_uae_rent_payments after insert or update or delete on rental.uae_rent_payments
  for each row execute function audit.fn_row_audit();

create or replace function rental.fn_apply_uae_rent_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outstanding numeric(18,2);
  v_new_outstanding numeric(18,2);
  v_schedule_id uuid;
begin
  select outstanding_balance, schedule_id into v_outstanding, v_schedule_id
  from rental.uae_rent_invoices where id = new.invoice_id;

  if new.amount > v_outstanding then
    raise exception 'Payment amount % exceeds outstanding balance %', new.amount, v_outstanding;
  end if;

  v_new_outstanding := v_outstanding - new.amount;

  update rental.uae_rent_invoices set outstanding_balance = v_new_outstanding where id = new.invoice_id;

  if v_new_outstanding = 0 and v_schedule_id is not null then
    update rental.uae_payment_schedules set status = 'paid' where id = v_schedule_id;
  end if;

  return new;
end;
$$;

create trigger trg_apply_uae_rent_payment
  after insert on rental.uae_rent_payments
  for each row execute function rental.fn_apply_uae_rent_payment();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table rental.tenants enable row level security;
alter table rental.uae_leases enable row level security;
alter table rental.uae_payment_schedules enable row level security;
alter table rental.uae_rent_invoices enable row level security;
alter table rental.uae_rent_payments enable row level security;

create policy tenants_select on rental.tenants
  for select using (company_id = core.current_company_id() and deleted_at is null);
create policy tenants_insert on rental.tenants
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('tenants', 'create'));
create policy tenants_update on rental.tenants
  for update using (company_id = core.current_company_id() and core.user_has_permission('tenants', 'edit'));

-- Leases and their schedule/invoices/payments exist only to support UAE
-- rent invoicing, so they're gated by the uae_rent_invoice permission set
-- rather than a module of their own — same rationale as suppliers being
-- gated by purchase_voucher in Phase 7.
create policy uae_leases_select on rental.uae_leases
  for select using (company_id = core.current_company_id() and deleted_at is null);
create policy uae_leases_insert on rental.uae_leases
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('uae_rent_invoice', 'create'));
create policy uae_leases_update on rental.uae_leases
  for update using (company_id = core.current_company_id() and core.user_has_permission('uae_rent_invoice', 'edit'));

create policy uae_payment_schedules_select on rental.uae_payment_schedules
  for select using (
    lease_id in (select id from rental.uae_leases where company_id = core.current_company_id())
  );

create policy uae_rent_invoices_select on rental.uae_rent_invoices
  for select using (company_id = core.current_company_id());
create policy uae_rent_invoices_insert on rental.uae_rent_invoices
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('uae_rent_invoice', 'create'));
create policy uae_rent_invoices_update on rental.uae_rent_invoices
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('uae_rent_invoice', 'edit') or core.user_has_permission('uae_rent_invoice', 'post'))
  );

create policy uae_rent_payments_select on rental.uae_rent_payments
  for select using (company_id = core.current_company_id());
create policy uae_rent_payments_insert on rental.uae_rent_payments
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('uae_rent_invoice', 'create'));

-- -----------------------------------------------------------------------------
-- Extend the Voucher Register to include UAE rent invoices.
-- -----------------------------------------------------------------------------

create or replace view accounting.v_voucher_register as
select je.company_id, je.voucher_type, je.voucher_id, je.entry_date,
       coalesce(rv.voucher_no, pv.voucher_no, ppv.voucher_no, prv.voucher_no,
                crv.voucher_no, jv.voucher_no, jvm.voucher_no, obv.voucher_no,
                purv.voucher_no, uri.voucher_no) as voucher_no,
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
left join rental.uae_rent_invoices uri on uri.journal_entry_id = je.id;

alter view accounting.v_voucher_register set (security_invoker = on);
