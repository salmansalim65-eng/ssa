-- Receipt Voucher → rental invoice allocation.
--
-- A generic Receipt Voucher previously only posted a GL entry and never touched
-- the rental invoice it collected against, so a rent receipt left the invoice's
-- outstanding balance (and therefore the dashboard / reports) unchanged.
--
-- This migration lets a receipt line be "applied to" a specific rental invoice.
-- When the voucher is posted, an allocation row is written and a trigger reduces
-- that invoice's outstanding balance — mirroring the existing rent-payment flow
-- (rental.fn_apply_uae_rent_payment). Deleting the voucher cascades the
-- allocation away and the trigger restores the outstanding balance.

-- 1. Remember, on each receipt line, which rental invoice it is applied to.
alter table accounting.receipt_voucher_lines
  add column if not exists applied_country text
    check (applied_country in ('UAE', 'PK')),
  add column if not exists applied_uae_invoice_id uuid
    references rental.uae_rent_invoices(id) on delete set null,
  add column if not exists applied_pk_invoice_id uuid
    references rental.pk_rent_invoices(id) on delete set null;

-- 2. The allocations that actually move outstanding (written when a receipt posts).
create table if not exists rental.receipt_invoice_allocations (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  receipt_voucher_id uuid not null references accounting.receipt_vouchers(id) on delete cascade,
  receipt_line_id    uuid references accounting.receipt_voucher_lines(id) on delete cascade,
  country            text not null check (country in ('UAE', 'PK')),
  uae_invoice_id     uuid references rental.uae_rent_invoices(id) on delete cascade,
  pk_invoice_id      uuid references rental.pk_rent_invoices(id) on delete cascade,
  amount             numeric(18, 2) not null check (amount > 0),
  created_at         timestamptz not null default now(),
  constraint receipt_alloc_invoice_ck check (
    (country = 'UAE' and uae_invoice_id is not null and pk_invoice_id is null) or
    (country = 'PK'  and pk_invoice_id  is not null and uae_invoice_id is null)
  )
);

create index if not exists idx_receipt_alloc_voucher on rental.receipt_invoice_allocations(receipt_voucher_id);
create index if not exists idx_receipt_alloc_uae on rental.receipt_invoice_allocations(uae_invoice_id);
create index if not exists idx_receipt_alloc_pk on rental.receipt_invoice_allocations(pk_invoice_id);

-- 3. Trigger: apply the allocation to the invoice's outstanding balance.
create or replace function rental.fn_apply_receipt_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.country = 'UAE' then
      update rental.uae_rent_invoices
        set outstanding_balance = greatest(0, outstanding_balance - new.amount)
        where id = new.uae_invoice_id;
    else
      update rental.pk_rent_invoices
        set outstanding_amount = greatest(0, outstanding_amount - new.amount)
        where id = new.pk_invoice_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.country = 'UAE' then
      update rental.uae_rent_invoices
        set outstanding_balance = outstanding_balance + old.amount
        where id = old.uae_invoice_id;
    else
      update rental.pk_rent_invoices
        set outstanding_amount = outstanding_amount + old.amount
        where id = old.pk_invoice_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_apply_receipt_allocation on rental.receipt_invoice_allocations;
create trigger trg_apply_receipt_allocation
  after insert or delete on rental.receipt_invoice_allocations
  for each row execute function rental.fn_apply_receipt_allocation();

-- 4. RLS — company-scoped, same shape as the other rental tables.
alter table rental.receipt_invoice_allocations enable row level security;

drop policy if exists receipt_alloc_select on rental.receipt_invoice_allocations;
create policy receipt_alloc_select on rental.receipt_invoice_allocations
  for select using (company_id = core.current_company_id());

drop policy if exists receipt_alloc_insert on rental.receipt_invoice_allocations;
create policy receipt_alloc_insert on rental.receipt_invoice_allocations
  for insert with check (company_id = core.current_company_id());

drop policy if exists receipt_alloc_delete on rental.receipt_invoice_allocations;
create policy receipt_alloc_delete on rental.receipt_invoice_allocations
  for delete using (company_id = core.current_company_id());
