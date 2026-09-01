-- Journal Voucher → rental invoice adjustment.
--
-- A Journal Voucher can now be "applied to" a specific rental invoice, exactly
-- like the Receipt / PDC Receipt adjustment — but bidirectional, because a JV
-- line has both a debit and a credit account and the tenant can be on either
-- side:
--   * tenant DEBITED  (billing)    → INCREASE that invoice's outstanding
--   * tenant CREDITED (collection) → DECREASE that invoice's outstanding
--
-- This is what lets a JV like "JULY RENT BALANCE" (Dr Tenant / Cr Rent Income)
-- raise the tenant's outstanding so a later Receipt voucher can collect against
-- it — the Receipt adjustment reads reporting.v_outstanding_rent, which is fed
-- by these invoice balances.

create table if not exists rental.journal_invoice_allocations (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references core.companies(id) on delete cascade,
  journal_voucher_id uuid not null references accounting.journal_vouchers(id) on delete cascade,
  journal_line_id    uuid references accounting.journal_voucher_lines(id) on delete cascade,
  country            text not null check (country in ('UAE', 'PK')),
  uae_invoice_id     uuid references rental.uae_rent_invoices(id) on delete cascade,
  pk_invoice_id      uuid references rental.pk_rent_invoices(id) on delete cascade,
  direction          text not null check (direction in ('increase', 'decrease')),
  amount             numeric(18, 2) not null check (amount > 0),
  created_at         timestamptz not null default now(),
  constraint journal_alloc_invoice_ck check (
    (country = 'UAE' and uae_invoice_id is not null and pk_invoice_id is null) or
    (country = 'PK'  and pk_invoice_id  is not null and uae_invoice_id is null)
  )
);

create index if not exists idx_journal_alloc_voucher on rental.journal_invoice_allocations(journal_voucher_id);
create index if not exists idx_journal_alloc_uae on rental.journal_invoice_allocations(uae_invoice_id);
create index if not exists idx_journal_alloc_pk on rental.journal_invoice_allocations(pk_invoice_id);

-- Trigger: move the invoice's outstanding balance by the signed amount. Billing
-- (increase) raises it; collection (decrease) lowers it. Delete reverses.
create or replace function rental.fn_apply_journal_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta numeric;
begin
  if tg_op = 'INSERT' then
    v_delta := case when new.direction = 'increase' then new.amount else -new.amount end;
    if new.country = 'UAE' then
      update rental.uae_rent_invoices
        set outstanding_balance = greatest(0, outstanding_balance + v_delta)
        where id = new.uae_invoice_id;
    else
      update rental.pk_rent_invoices
        set outstanding_amount = greatest(0, outstanding_amount + v_delta)
        where id = new.pk_invoice_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    v_delta := case when old.direction = 'increase' then old.amount else -old.amount end;
    if old.country = 'UAE' then
      update rental.uae_rent_invoices
        set outstanding_balance = greatest(0, outstanding_balance - v_delta)
        where id = old.uae_invoice_id;
    else
      update rental.pk_rent_invoices
        set outstanding_amount = greatest(0, outstanding_amount - v_delta)
        where id = old.pk_invoice_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_apply_journal_allocation on rental.journal_invoice_allocations;
create trigger trg_apply_journal_allocation
  after insert or delete on rental.journal_invoice_allocations
  for each row execute function rental.fn_apply_journal_allocation();

-- RLS — company-scoped, same shape as the other rental allocation tables.
alter table rental.journal_invoice_allocations enable row level security;

drop policy if exists journal_alloc_select on rental.journal_invoice_allocations;
create policy journal_alloc_select on rental.journal_invoice_allocations
  for select using (company_id = core.current_company_id());

drop policy if exists journal_alloc_insert on rental.journal_invoice_allocations;
create policy journal_alloc_insert on rental.journal_invoice_allocations
  for insert with check (company_id = core.current_company_id());

drop policy if exists journal_alloc_delete on rental.journal_invoice_allocations;
create policy journal_alloc_delete on rental.journal_invoice_allocations
  for delete using (company_id = core.current_company_id());

grant select, insert, update, delete on rental.journal_invoice_allocations to authenticated;
