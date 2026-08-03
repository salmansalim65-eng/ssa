-- =============================================================================
-- Phase 5: Core Accounting Vouchers
-- Receipt, Payment, Post-Dated Payment, Post-Dated Receipt, Cheque Return,
-- Journal Voucher, JV Maintenance, Opening Balance Voucher.
--
-- Design note: unlike Purchase/Sale/Rent-Invoice vouchers in later phases
-- (which always post to the same GL accounts and so read them from
-- posting_templates), every voucher here lets the user pick both sides of
-- the entry directly from the Chart of Accounts — the contra account
-- genuinely varies transaction-to-transaction for a Receipt or Payment, so
-- a fixed per-voucher-type template would just get in the way. That's why
-- posting_templates stays unused until Phase 7.
--
-- Design note 2: no voucher table carries its own status/approved_by/
-- posted_by columns. accounting.journal_entries is the single source of
-- truth for that (via journal_entry_id); duplicating it per voucher table
-- would just invite the two to drift out of sync.
-- =============================================================================

-- Fix from Phase 4: submitting for approval, recording an approve/reject/
-- send-back decision, and posting are all UPDATEs of
-- accounting.journal_entries (status -> pending/approved/rejected/
-- sent_back/posted). The RLS policy gating UPDATE must accept a caller who
-- holds any one of the relevant permissions, not just 'edit' — the
-- precise, per-action authorization is enforced downstream by
-- fn_approval_action (role-gated per step) and fn_enforce_balanced_entry
-- (requires 'post'), so this is deliberately the coarser of the two gates.
drop policy journal_entries_update on accounting.journal_entries;
create policy journal_entries_update on accounting.journal_entries
  for update using (
    company_id = core.current_company_id()
    and (
      core.user_has_permission(voucher_type, 'edit')
      or core.user_has_permission(voucher_type, 'post')
      or core.user_has_permission(voucher_type, 'approve')
      or core.user_has_permission(voucher_type, 'reject')
    )
  );

-- Same reasoning applies to the lines: they're inserted as part of the
-- same create step as the header, so 'create' must be enough — 'edit'
-- alone was too narrow.
drop policy journal_entry_lines_write on accounting.journal_entry_lines;
create policy journal_entry_lines_write on accounting.journal_entry_lines
  for all using (
    exists (
      select 1 from accounting.journal_entries je
      where je.id = journal_entry_id
        and je.company_id = core.current_company_id()
        and (core.user_has_permission(je.voucher_type, 'create') or core.user_has_permission(je.voucher_type, 'edit'))
    )
  ) with check (
    exists (
      select 1 from accounting.journal_entries je
      where je.id = journal_entry_id
        and je.company_id = core.current_company_id()
        and (core.user_has_permission(je.voucher_type, 'create') or core.user_has_permission(je.voucher_type, 'edit'))
    )
  );

create table accounting.receipt_vouchers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  journal_entry_id  uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no        text,
  receipt_date      date not null,
  received_from     text not null,
  debit_account_id  uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  credit_account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  currency_id       uuid not null references core.currencies(id) on delete restrict,
  exchange_rate     numeric(18,6) not null default 1 check (exchange_rate > 0),
  amount            numeric(18,2) not null check (amount > 0),
  narration         text,
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  constraint receipt_vouchers_no_unique unique (company_id, voucher_no)
);

create table accounting.payment_vouchers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  journal_entry_id  uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no        text,
  payment_date      date not null,
  paid_to           text not null,
  debit_account_id  uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  credit_account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  currency_id       uuid not null references core.currencies(id) on delete restrict,
  exchange_rate     numeric(18,6) not null default 1 check (exchange_rate > 0),
  amount            numeric(18,2) not null check (amount > 0),
  narration         text,
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  constraint payment_vouchers_no_unique unique (company_id, voucher_no)
);

create table accounting.pdc_payment_vouchers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  journal_entry_id  uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no        text,
  cheque_no         text not null,
  cheque_date       date not null,
  payee             text not null,
  debit_account_id  uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  credit_account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  currency_id       uuid not null references core.currencies(id) on delete restrict,
  exchange_rate     numeric(18,6) not null default 1 check (exchange_rate > 0),
  amount            numeric(18,2) not null check (amount > 0),
  pdc_status        text not null default 'pending' check (pdc_status in ('pending','cleared','returned','cancelled')),
  narration         text,
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  constraint pdc_payment_vouchers_no_unique unique (company_id, voucher_no)
);

create table accounting.pdc_receipt_vouchers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  journal_entry_id  uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no        text,
  cheque_no         text not null,
  cheque_date       date not null,
  payer             text not null,
  debit_account_id  uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  credit_account_id uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  currency_id       uuid not null references core.currencies(id) on delete restrict,
  exchange_rate     numeric(18,6) not null default 1 check (exchange_rate > 0),
  amount            numeric(18,2) not null check (amount > 0),
  pdc_status        text not null default 'pending' check (pdc_status in ('pending','cleared','returned','cancelled')),
  narration         text,
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  constraint pdc_receipt_vouchers_no_unique unique (company_id, voucher_no)
);

create table accounting.cheque_return_vouchers (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  journal_entry_id    uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no          text,
  original_pdc_type   text not null check (original_pdc_type in ('pdc_payment_voucher','pdc_receipt_voucher')),
  original_pdc_id     uuid not null,
  return_date         date not null,
  return_reason       text not null,
  penalty_amount      numeric(18,2) not null default 0 check (penalty_amount >= 0),
  penalty_account_id  uuid references accounting.chart_of_accounts(id) on delete restrict,
  currency_id         uuid not null references core.currencies(id) on delete restrict,
  exchange_rate       numeric(18,6) not null default 1 check (exchange_rate > 0),
  created_by          uuid not null references auth.users(id),
  created_at          timestamptz not null default now(),
  constraint cheque_return_vouchers_no_unique unique (company_id, voucher_no),
  constraint cheque_return_penalty_needs_account check (penalty_amount = 0 or penalty_account_id is not null)
);

create index idx_cheque_return_original_pdc on accounting.cheque_return_vouchers(original_pdc_type, original_pdc_id);

create table accounting.journal_vouchers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  journal_entry_id  uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no        text,
  entry_date        date not null,
  narration         text not null,
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  constraint journal_vouchers_no_unique unique (company_id, voucher_no)
);

create table accounting.jv_maintenance_vouchers (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  journal_entry_id    uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no          text,
  original_jv_id      uuid not null references accounting.journal_vouchers(id) on delete restrict,
  adjustment_reason   text not null,
  created_by          uuid not null references auth.users(id),
  created_at          timestamptz not null default now(),
  constraint jv_maintenance_vouchers_no_unique unique (company_id, voucher_no)
);

create table accounting.opening_balance_vouchers (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references core.companies(id) on delete cascade,
  journal_entry_id    uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no          text,
  as_of_date          date not null,
  account_id          uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  contra_account_id   uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  currency_id         uuid not null references core.currencies(id) on delete restrict,
  exchange_rate       numeric(18,6) not null default 1 check (exchange_rate > 0),
  debit_amount        numeric(18,2) not null default 0 check (debit_amount >= 0),
  credit_amount       numeric(18,2) not null default 0 check (credit_amount >= 0),
  created_by          uuid not null references auth.users(id),
  created_at          timestamptz not null default now(),
  constraint opening_balance_vouchers_no_unique unique (company_id, voucher_no),
  constraint opening_balance_one_side check (
    (debit_amount > 0 and credit_amount = 0) or (credit_amount > 0 and debit_amount = 0)
  )
);

-- -----------------------------------------------------------------------------
-- Audit triggers (all business tables get one; none of these need the
-- updated_at touch trigger since they're immutable after creation — the
-- linked journal_entry is what carries lifecycle state).
-- -----------------------------------------------------------------------------

create trigger trg_audit_receipt_vouchers after insert or update or delete on accounting.receipt_vouchers
  for each row execute function audit.fn_row_audit();
create trigger trg_audit_payment_vouchers after insert or update or delete on accounting.payment_vouchers
  for each row execute function audit.fn_row_audit();
create trigger trg_audit_pdc_payment_vouchers after insert or update or delete on accounting.pdc_payment_vouchers
  for each row execute function audit.fn_row_audit();
create trigger trg_audit_pdc_receipt_vouchers after insert or update or delete on accounting.pdc_receipt_vouchers
  for each row execute function audit.fn_row_audit();
create trigger trg_audit_cheque_return_vouchers after insert or update or delete on accounting.cheque_return_vouchers
  for each row execute function audit.fn_row_audit();
create trigger trg_audit_journal_vouchers after insert or update or delete on accounting.journal_vouchers
  for each row execute function audit.fn_row_audit();
create trigger trg_audit_jv_maintenance_vouchers after insert or update or delete on accounting.jv_maintenance_vouchers
  for each row execute function audit.fn_row_audit();
create trigger trg_audit_opening_balance_vouchers after insert or update or delete on accounting.opening_balance_vouchers
  for each row execute function audit.fn_row_audit();

-- pdc_status can still change after posting (a posted PDC's cheque later
-- clears or bounces) — touch trigger just for that column.
create trigger trg_pdc_payment_vouchers_touch
  before update of pdc_status on accounting.pdc_payment_vouchers
  for each row execute function core.fn_touch_updated_at();
create trigger trg_pdc_receipt_vouchers_touch
  before update of pdc_status on accounting.pdc_receipt_vouchers
  for each row execute function core.fn_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security — identical shape for every voucher table: scoped to
-- the active company, gated by that voucher type's own permission catalog
-- entries (already seeded in Phase 1).
-- -----------------------------------------------------------------------------

alter table accounting.receipt_vouchers enable row level security;
alter table accounting.payment_vouchers enable row level security;
alter table accounting.pdc_payment_vouchers enable row level security;
alter table accounting.pdc_receipt_vouchers enable row level security;
alter table accounting.cheque_return_vouchers enable row level security;
alter table accounting.journal_vouchers enable row level security;
alter table accounting.jv_maintenance_vouchers enable row level security;
alter table accounting.opening_balance_vouchers enable row level security;

create policy receipt_vouchers_select on accounting.receipt_vouchers
  for select using (company_id = core.current_company_id());
create policy receipt_vouchers_insert on accounting.receipt_vouchers
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('receipt_voucher', 'create'));
create policy receipt_vouchers_update on accounting.receipt_vouchers
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('receipt_voucher', 'edit') or core.user_has_permission('receipt_voucher', 'post'))
  );

create policy payment_vouchers_select on accounting.payment_vouchers
  for select using (company_id = core.current_company_id());
create policy payment_vouchers_insert on accounting.payment_vouchers
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('payment_voucher', 'create'));
create policy payment_vouchers_update on accounting.payment_vouchers
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('payment_voucher', 'edit') or core.user_has_permission('payment_voucher', 'post'))
  );

create policy pdc_payment_vouchers_select on accounting.pdc_payment_vouchers
  for select using (company_id = core.current_company_id());
create policy pdc_payment_vouchers_insert on accounting.pdc_payment_vouchers
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('pdc_payment_voucher', 'create'));
create policy pdc_payment_vouchers_update on accounting.pdc_payment_vouchers
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('pdc_payment_voucher', 'edit') or core.user_has_permission('pdc_payment_voucher', 'post'))
  );

create policy pdc_receipt_vouchers_select on accounting.pdc_receipt_vouchers
  for select using (company_id = core.current_company_id());
create policy pdc_receipt_vouchers_insert on accounting.pdc_receipt_vouchers
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('pdc_receipt_voucher', 'create'));
create policy pdc_receipt_vouchers_update on accounting.pdc_receipt_vouchers
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('pdc_receipt_voucher', 'edit') or core.user_has_permission('pdc_receipt_voucher', 'post'))
  );

create policy cheque_return_vouchers_select on accounting.cheque_return_vouchers
  for select using (company_id = core.current_company_id());
create policy cheque_return_vouchers_insert on accounting.cheque_return_vouchers
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('cheque_return_voucher', 'create'));
create policy cheque_return_vouchers_update on accounting.cheque_return_vouchers
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('cheque_return_voucher', 'edit') or core.user_has_permission('cheque_return_voucher', 'post'))
  );

create policy journal_vouchers_select on accounting.journal_vouchers
  for select using (company_id = core.current_company_id());
create policy journal_vouchers_insert on accounting.journal_vouchers
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('journal_voucher', 'create'));
create policy journal_vouchers_update on accounting.journal_vouchers
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('journal_voucher', 'edit') or core.user_has_permission('journal_voucher', 'post'))
  );

create policy jv_maintenance_vouchers_select on accounting.jv_maintenance_vouchers
  for select using (company_id = core.current_company_id());
create policy jv_maintenance_vouchers_insert on accounting.jv_maintenance_vouchers
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('jv_maintenance_voucher', 'create'));
create policy jv_maintenance_vouchers_update on accounting.jv_maintenance_vouchers
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('jv_maintenance_voucher', 'edit') or core.user_has_permission('jv_maintenance_voucher', 'post'))
  );

create policy opening_balance_vouchers_select on accounting.opening_balance_vouchers
  for select using (company_id = core.current_company_id());
create policy opening_balance_vouchers_insert on accounting.opening_balance_vouchers
  for insert with check (company_id = core.current_company_id() and core.user_has_permission('opening_balance_voucher', 'create'));
create policy opening_balance_vouchers_update on accounting.opening_balance_vouchers
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('opening_balance_voucher', 'edit') or core.user_has_permission('opening_balance_voucher', 'post'))
  );

-- -----------------------------------------------------------------------------
-- Voucher Register — a union of every voucher type, the first report that
-- exercises the engine end-to-end.
-- -----------------------------------------------------------------------------

create or replace view accounting.v_voucher_register as
select je.company_id, je.voucher_type, je.voucher_id, je.entry_date,
       coalesce(rv.voucher_no, pv.voucher_no, ppv.voucher_no, prv.voucher_no,
                crv.voucher_no, jv.voucher_no, jvm.voucher_no, obv.voucher_no) as voucher_no,
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
left join accounting.opening_balance_vouchers obv on obv.journal_entry_id = je.id;

comment on view accounting.v_voucher_register is
  'One row per voucher across every type in Phase 5, backing the Voucher Register report. Inherits RLS from accounting.journal_entries via the security_invoker view setting below.';

alter view accounting.v_voucher_register set (security_invoker = on);
