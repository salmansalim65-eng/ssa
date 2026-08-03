-- =============================================================================
-- Phase 10: Pakistan Rental Management
-- Pakistan leases (always monthly), the payment schedule a lease generates,
-- rent invoices carrying rent + utility charges net of any advance-rent
-- adjustment, and payment collection against those invoices. Mirrors the
-- UAE rental structure from Phase 9, adapted for PK-specific fields.
-- =============================================================================

-- rental.tenants and the 'tenants' permission module already exist from
-- Phase 9 and are shared as-is; 'pk_rent_invoice' was already seeded into
-- core.permissions by Phase 1's cross join, so no new permission rows are
-- needed here.

create table rental.pk_leases (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  asset_id          uuid not null references assets.assets(id) on delete restrict,
  tenant_id         uuid not null references rental.tenants(id) on delete restrict,
  lease_start       date not null,
  lease_end         date not null,
  monthly_rent      numeric(18,2) not null check (monthly_rent > 0),
  advance_rent      numeric(18,2) not null default 0 check (advance_rent >= 0),
  security_deposit  numeric(18,2) not null default 0 check (security_deposit >= 0),
  currency_id       uuid not null references core.currencies(id) on delete restrict,
  status            text not null default 'active' check (status in ('active','expired','terminated')),
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id),
  updated_at        timestamptz,
  deleted_by        uuid references auth.users(id),
  deleted_at        timestamptz,
  constraint pk_leases_dates check (lease_end > lease_start)
);

create index idx_pk_leases_asset on rental.pk_leases(asset_id);
create index idx_pk_leases_tenant on rental.pk_leases(tenant_id);

create trigger trg_pk_leases_touch
  before update on rental.pk_leases
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_pk_leases after insert or update or delete on rental.pk_leases
  for each row execute function audit.fn_row_audit();

create table rental.pk_payment_schedules (
  id          uuid primary key default gen_random_uuid(),
  lease_id    uuid not null references rental.pk_leases(id) on delete cascade,
  due_date    date not null,
  amount      numeric(18,2) not null check (amount > 0),
  status      text not null default 'pending' check (status in ('pending','invoiced','paid','overdue')),
  created_at  timestamptz not null default now(),
  constraint pk_payment_schedules_unique unique (lease_id, due_date)
);

create index idx_pk_payment_schedules_lease on rental.pk_payment_schedules(lease_id, due_date);

create trigger trg_audit_pk_payment_schedules after insert or update or delete on rental.pk_payment_schedules
  for each row execute function audit.fn_row_audit();

-- Pakistan leases are always monthly (unlike UAE's monthly/yearly choice),
-- so the step is fixed rather than read off the lease row.
create or replace function rental.fn_generate_pk_payment_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due_date date;
begin
  v_due_date := new.lease_start;

  while v_due_date <= new.lease_end loop
    insert into rental.pk_payment_schedules (lease_id, due_date, amount)
    values (new.id, v_due_date, new.monthly_rent);
    v_due_date := (v_due_date + interval '1 month')::date;
  end loop;

  return new;
end;
$$;

create trigger trg_generate_pk_payment_schedule
  after insert on rental.pk_leases
  for each row execute function rental.fn_generate_pk_payment_schedule();

-- -----------------------------------------------------------------------------
-- Pakistan rent invoices — rent + utility recovery, net of any advance-rent
-- adjustment, posted through the same journal engine as every other
-- voucher via posting_templates.
-- -----------------------------------------------------------------------------

create table rental.pk_rent_invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  journal_entry_id  uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no        text,
  lease_id          uuid not null references rental.pk_leases(id) on delete restrict,
  schedule_id       uuid references rental.pk_payment_schedules(id) on delete set null,
  invoice_date      date not null,
  due_date          date not null,
  rent_amount       numeric(18,2) not null check (rent_amount > 0),
  utility_charges   numeric(18,2) not null default 0 check (utility_charges >= 0),
  advance_adjusted  numeric(18,2) not null default 0 check (advance_adjusted >= 0),
  total_amount      numeric(18,2) generated always as (rent_amount + utility_charges - advance_adjusted) stored,
  currency_id       uuid not null references core.currencies(id) on delete restrict,
  exchange_rate     numeric(18,6) not null default 1 check (exchange_rate > 0),
  outstanding_amount numeric(18,2) not null check (outstanding_amount >= 0),
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  constraint pk_rent_invoices_no_unique unique (company_id, voucher_no),
  constraint pk_rent_invoices_advance_not_over check (advance_adjusted <= rent_amount + utility_charges)
);

create index idx_pk_rent_invoices_lease on rental.pk_rent_invoices(lease_id);

create trigger trg_audit_pk_rent_invoices after insert or update or delete on rental.pk_rent_invoices
  for each row execute function audit.fn_row_audit();

-- An invoice can only draw down as much advance as the lease has left
-- unadjusted so far — cross-row, so it has to be a trigger rather than a
-- column check.
create or replace function rental.fn_validate_pk_advance_adjustment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_advance_rent numeric(18,2);
  v_already_adjusted numeric(18,2);
begin
  if new.advance_adjusted > 0 then
    select advance_rent into v_advance_rent from rental.pk_leases where id = new.lease_id;
    select coalesce(sum(advance_adjusted), 0) into v_already_adjusted
      from rental.pk_rent_invoices where lease_id = new.lease_id;

    if v_already_adjusted + new.advance_adjusted > v_advance_rent then
      raise exception 'Advance adjustment % exceeds remaining advance balance % for this lease',
        new.advance_adjusted, v_advance_rent - v_already_adjusted;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_validate_pk_advance_adjustment
  before insert on rental.pk_rent_invoices
  for each row execute function rental.fn_validate_pk_advance_adjustment();

-- Marks the schedule entry this invoice was generated from so it drops out
-- of "due for invoicing" lists.
create or replace function rental.fn_mark_pk_schedule_invoiced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.schedule_id is not null then
    update rental.pk_payment_schedules set status = 'invoiced' where id = new.schedule_id;
  end if;
  return new;
end;
$$;

create trigger trg_mark_pk_schedule_invoiced
  after insert on rental.pk_rent_invoices
  for each row execute function rental.fn_mark_pk_schedule_invoiced();

-- Individual utility line items behind an invoice's utility_charges total
-- (electricity/gas/water/other), captured at invoice-generation time.
create table rental.pk_utility_charges (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references rental.pk_rent_invoices(id) on delete cascade,
  utility_type text not null check (utility_type in ('electricity','gas','water','other')),
  amount       numeric(18,2) not null check (amount > 0),
  description  text,
  created_at   timestamptz not null default now()
);

create index idx_pk_utility_charges_invoice on rental.pk_utility_charges(invoice_id);

create trigger trg_audit_pk_utility_charges after insert or update or delete on rental.pk_utility_charges
  for each row execute function audit.fn_row_audit();

-- Records money received against a specific invoice. Same shape and
-- rationale as rental.uae_rent_payments in Phase 9 — its own small JE
-- posted immediately (Dr Cash/Bank, Cr Tenant Receivable) rather than
-- routing through the draft->approval->post pipeline.
create table rental.pk_rent_payments (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references core.companies(id) on delete cascade,
  invoice_id            uuid not null references rental.pk_rent_invoices(id) on delete restrict,
  journal_entry_id      uuid not null references accounting.journal_entries(id) on delete restrict,
  payment_date          date not null,
  amount                numeric(18,2) not null check (amount > 0),
  cash_bank_account_id  uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  created_by            uuid not null references auth.users(id),
  created_at            timestamptz not null default now()
);

create index idx_pk_rent_payments_invoice on rental.pk_rent_payments(invoice_id);

create trigger trg_audit_pk_rent_payments after insert or update or delete on rental.pk_rent_payments
  for each row execute function audit.fn_row_audit();

create or replace function rental.fn_apply_pk_rent_payment()
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
  select outstanding_amount, schedule_id into v_outstanding, v_schedule_id
  from rental.pk_rent_invoices where id = new.invoice_id;

  if new.amount > v_outstanding then
    raise exception 'Payment amount % exceeds outstanding amount %', new.amount, v_outstanding;
  end if;

  v_new_outstanding := v_outstanding - new.amount;

  update rental.pk_rent_invoices set outstanding_amount = v_new_outstanding where id = new.invoice_id;

  if v_new_outstanding = 0 and v_schedule_id is not null then
    update rental.pk_payment_schedules set status = 'paid' where id = v_schedule_id;
  end if;

  return new;
end;
$$;

create trigger trg_apply_pk_rent_payment
  after insert on rental.pk_rent_payments
  for each row execute function rental.fn_apply_pk_rent_payment();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table rental.pk_leases enable row level security;
alter table rental.pk_payment_schedules enable row level security;
alter table rental.pk_rent_invoices enable row level security;
alter table rental.pk_utility_charges enable row level security;
alter table rental.pk_rent_payments enable row level security;

-- Gated by the pk_rent_invoice permission set, same rationale as UAE leases
-- being gated by uae_rent_invoice in Phase 9.
create policy pk_leases_select on rental.pk_leases
  for select using (company_id = core.current_company_id() and deleted_at is null);
create policy pk_leases_insert on rental.pk_leases
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('pk_rent_invoice', 'create'));
create policy pk_leases_update on rental.pk_leases
  for update using (company_id = core.current_company_id() and core.user_has_permission('pk_rent_invoice', 'edit'));

create policy pk_payment_schedules_select on rental.pk_payment_schedules
  for select using (
    lease_id in (select id from rental.pk_leases where company_id = core.current_company_id())
  );

create policy pk_rent_invoices_select on rental.pk_rent_invoices
  for select using (company_id = core.current_company_id());
create policy pk_rent_invoices_insert on rental.pk_rent_invoices
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('pk_rent_invoice', 'create'));
create policy pk_rent_invoices_update on rental.pk_rent_invoices
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('pk_rent_invoice', 'edit') or core.user_has_permission('pk_rent_invoice', 'post'))
  );

create policy pk_utility_charges_select on rental.pk_utility_charges
  for select using (
    invoice_id in (select id from rental.pk_rent_invoices where company_id = core.current_company_id())
  );
create policy pk_utility_charges_insert on rental.pk_utility_charges
  for insert with check (
    invoice_id in (
      select id from rental.pk_rent_invoices
      where company_id = core.current_company_id() and core.user_has_permission('pk_rent_invoice', 'create')
    )
  );

create policy pk_rent_payments_select on rental.pk_rent_payments
  for select using (company_id = core.current_company_id());
create policy pk_rent_payments_insert on rental.pk_rent_payments
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('pk_rent_invoice', 'create'));

-- -----------------------------------------------------------------------------
-- Extend the Voucher Register to include Pakistan rent invoices.
-- -----------------------------------------------------------------------------

create or replace view accounting.v_voucher_register as
select je.company_id, je.voucher_type, je.voucher_id, je.entry_date,
       coalesce(rv.voucher_no, pv.voucher_no, ppv.voucher_no, prv.voucher_no,
                crv.voucher_no, jv.voucher_no, jvm.voucher_no, obv.voucher_no,
                purv.voucher_no, uri.voucher_no, pri.voucher_no) as voucher_no,
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
left join rental.pk_rent_invoices pri on pri.journal_entry_id = je.id;

alter view accounting.v_voucher_register set (security_invoker = on);
