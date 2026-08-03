-- =============================================================================
-- Phase 4: Accounting Engine Core
-- The shared double-entry journal engine, data-driven posting-template
-- table, the generic multi-level approval workflow engine, and atomic
-- document numbering. No end-user voucher screens ship in this phase —
-- every voucher type in Phase 5+ is built on top of what's here.
-- =============================================================================

-- Canonical voucher_type values used across document_sequences,
-- posting_templates, approval_workflows, and journal_entries. These mirror
-- the module_key values already seeded into core.permissions in Phase 1.
alter table core.document_sequences
  add constraint document_sequences_voucher_type_check check (voucher_type in (
    'purchase_voucher','receipt_voucher','payment_voucher','pdc_payment_voucher',
    'pdc_receipt_voucher','cheque_return_voucher','journal_voucher',
    'jv_maintenance_voucher','opening_balance_voucher','uae_rent_invoice',
    'pk_rent_invoice','asset_sales'
  ));

insert into core.permissions (module_key, action, label)
select 'posting_templates', a.action, initcap(a.action) || ' posting templates'
from (values ('view'),('create'),('edit'),('delete'),('print'),('export'),('approve'),('reject'),('post')) as a(action)
on conflict (module_key, action) do nothing;

-- -----------------------------------------------------------------------------
-- 1. Journal engine
-- -----------------------------------------------------------------------------

create table accounting.journal_entries (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  entry_date       date not null,
  voucher_type     text not null check (voucher_type in (
    'purchase_voucher','receipt_voucher','payment_voucher','pdc_payment_voucher',
    'pdc_receipt_voucher','cheque_return_voucher','journal_voucher',
    'jv_maintenance_voucher','opening_balance_voucher','uae_rent_invoice',
    'pk_rent_invoice','asset_sales'
  )),
  voucher_id       uuid not null,
  currency_id      uuid not null references core.currencies(id) on delete restrict,
  exchange_rate    numeric(18,6) not null default 1 check (exchange_rate > 0),
  narration        text,
  status           text not null default 'draft' check (status in ('draft','pending','approved','posted','rejected','sent_back')),
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz,
  approved_by      uuid references auth.users(id),
  approved_at      timestamptz,
  posted_by        uuid references auth.users(id),
  posted_at        timestamptz,
  constraint journal_entries_voucher_unique unique (voucher_type, voucher_id)
);

create index idx_journal_entries_company_date on accounting.journal_entries(company_id, entry_date);
create index idx_journal_entries_voucher on accounting.journal_entries(voucher_type, voucher_id);

create trigger trg_journal_entries_touch
  before update on accounting.journal_entries
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_journal_entries after insert or update or delete on accounting.journal_entries
  for each row execute function audit.fn_row_audit();

create table accounting.journal_entry_lines (
  id                 uuid primary key default gen_random_uuid(),
  journal_entry_id   uuid not null references accounting.journal_entries(id) on delete cascade,
  line_no            smallint not null check (line_no > 0),
  account_id         uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  cost_center_id     uuid references accounting.cost_centers(id) on delete restrict,
  debit_amount       numeric(18,2) not null default 0 check (debit_amount >= 0),
  credit_amount      numeric(18,2) not null default 0 check (credit_amount >= 0),
  currency_id        uuid not null references core.currencies(id) on delete restrict,
  exchange_rate      numeric(18,6) not null default 1 check (exchange_rate > 0),
  base_debit_amount  numeric(18,2) not null default 0 check (base_debit_amount >= 0),
  base_credit_amount numeric(18,2) not null default 0 check (base_credit_amount >= 0),
  description        text,
  constraint journal_entry_lines_unique_line unique (journal_entry_id, line_no),
  constraint journal_entry_lines_one_side check (not (debit_amount > 0 and credit_amount > 0))
);

create index idx_journal_entry_lines_entry on accounting.journal_entry_lines(journal_entry_id);
create index idx_journal_entry_lines_account on accounting.journal_entry_lines(account_id);
create index idx_journal_entry_lines_cost_center on accounting.journal_entry_lines(cost_center_id);

create trigger trg_audit_journal_entry_lines after insert or update or delete on accounting.journal_entry_lines
  for each row execute function audit.fn_row_audit();

-- Only a group/header account organizes the tree; it must never receive a
-- posting directly.
create or replace function accounting.fn_prevent_posting_to_group_account()
returns trigger
language plpgsql
as $$
declare
  v_is_group boolean;
begin
  select is_group into v_is_group from accounting.chart_of_accounts where id = new.account_id;
  if v_is_group then
    raise exception 'Cannot post to a group/header account';
  end if;
  return new;
end;
$$;

create trigger trg_prevent_posting_to_group_account
  before insert or update of account_id on accounting.journal_entry_lines
  for each row execute function accounting.fn_prevent_posting_to_group_account();

-- Journal entries are immutable once posted; corrections happen via a new
-- reversing/adjusting Journal Voucher (Phase 5), never by editing history.
create or replace function accounting.fn_prevent_posted_entry_changes()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'posted' then
    raise exception 'Journal entry % is posted and cannot be modified', old.id;
  end if;
  return new;
end;
$$;

create trigger trg_prevent_posted_entry_update
  before update on accounting.journal_entries
  for each row execute function accounting.fn_prevent_posted_entry_changes();

create or replace function accounting.fn_prevent_posted_line_changes()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from accounting.journal_entries
  where id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if v_status = 'posted' then
    raise exception 'Journal entry lines cannot change once the entry is posted';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_prevent_posted_line_update
  before update or delete on accounting.journal_entry_lines
  for each row execute function accounting.fn_prevent_posted_line_changes();

-- The heart of double-entry accounting: block the transition into 'posted'
-- unless the lines balance in base currency, and require the caller to hold
-- the voucher type's 'post' permission.
create or replace function accounting.fn_enforce_balanced_entry()
returns trigger
language plpgsql
as $$
declare
  v_debit numeric(18,2);
  v_credit numeric(18,2);
begin
  if new.status = 'posted' and old.status <> 'posted' then
    if not core.user_has_permission(new.voucher_type, 'post') then
      raise exception 'Not permitted to post %', new.voucher_type;
    end if;

    select coalesce(sum(base_debit_amount), 0), coalesce(sum(base_credit_amount), 0)
      into v_debit, v_credit
    from accounting.journal_entry_lines
    where journal_entry_id = new.id;

    if v_debit = 0 and v_credit = 0 then
      raise exception 'Cannot post an empty journal entry';
    end if;
    if v_debit <> v_credit then
      raise exception 'Journal entry is not balanced: debit % <> credit %', v_debit, v_credit;
    end if;

    new.posted_by := auth.uid();
    new.posted_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_enforce_balanced_entry
  before update of status on accounting.journal_entries
  for each row execute function accounting.fn_enforce_balanced_entry();

-- -----------------------------------------------------------------------------
-- 2. Posting templates — data-driven account mapping per voucher type.
-- Each voucher type's own posting function (Phase 5+) resolves its account
-- roles (e.g. 'supplier_payable', 'cash_bank') through this table instead of
-- hardcoding account ids.
-- -----------------------------------------------------------------------------

create table accounting.posting_templates (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references core.companies(id) on delete cascade,
  voucher_type   text not null check (voucher_type in (
    'purchase_voucher','receipt_voucher','payment_voucher','pdc_payment_voucher',
    'pdc_receipt_voucher','cheque_return_voucher','journal_voucher',
    'jv_maintenance_voucher','opening_balance_voucher','uae_rent_invoice',
    'pk_rent_invoice','asset_sales'
  )),
  account_role   text not null,
  debit_or_credit text not null check (debit_or_credit in ('debit','credit')),
  account_id     uuid not null references accounting.chart_of_accounts(id) on delete restrict,
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz,
  constraint posting_templates_unique unique (company_id, voucher_type, account_role)
);

create trigger trg_posting_templates_touch
  before update on accounting.posting_templates
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_posting_templates after insert or update or delete on accounting.posting_templates
  for each row execute function audit.fn_row_audit();

create or replace function accounting.fn_get_posting_account(
  p_company_id uuid, p_voucher_type text, p_account_role text
)
returns uuid
language sql
stable
as $$
  select account_id from accounting.posting_templates
  where company_id = p_company_id and voucher_type = p_voucher_type and account_role = p_account_role;
$$;

comment on function accounting.fn_get_posting_account(uuid, text, text) is
  'Resolves the configured chart_of_accounts id for a (voucher_type, account_role) pair, e.g. (''purchase_voucher'', ''supplier_payable''). Returns null if unconfigured — callers must handle that explicitly rather than posting to a missing account.';

-- -----------------------------------------------------------------------------
-- 3. Document numbering (atomic, gapless-under-concurrency)
-- -----------------------------------------------------------------------------

create or replace function core.fn_next_document_number(p_company_id uuid, p_voucher_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq core.document_sequences%rowtype;
  v_number text;
begin
  select * into v_seq
  from core.document_sequences
  where company_id = p_company_id and voucher_type = p_voucher_type
  for update;

  if not found then
    raise exception 'No document sequence configured for voucher type %', p_voucher_type;
  end if;

  -- reset_policy 'yearly'/'monthly' is stored but not yet enforced here —
  -- that needs a last-reset date to compare against, added when the first
  -- voucher type that wants period-based resets ships in Phase 5.
  v_number := v_seq.prefix || '-' || lpad(v_seq.next_number::text, v_seq.padding, '0');

  update core.document_sequences
  set next_number = next_number + 1, updated_by = auth.uid(), updated_at = now()
  where id = v_seq.id;

  return v_number;
end;
$$;

comment on function core.fn_next_document_number(uuid, text) is
  'Atomically hands out the next document number (e.g. PV-000001) for a company + voucher type, using SELECT ... FOR UPDATE to serialize concurrent callers.';

-- -----------------------------------------------------------------------------
-- 4. Approval workflow engine (generic across every voucher type)
-- -----------------------------------------------------------------------------

create table accounting.approval_workflows (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references core.companies(id) on delete cascade,
  voucher_type   text not null check (voucher_type in (
    'purchase_voucher','receipt_voucher','payment_voucher','pdc_payment_voucher',
    'pdc_receipt_voucher','cheque_return_voucher','journal_voucher',
    'jv_maintenance_voucher','opening_balance_voucher','uae_rent_invoice',
    'pk_rent_invoice','asset_sales'
  )),
  is_active      boolean not null default true,
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz,
  constraint approval_workflows_unique unique (company_id, voucher_type)
);

create trigger trg_approval_workflows_touch
  before update on accounting.approval_workflows
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_approval_workflows after insert or update or delete on accounting.approval_workflows
  for each row execute function audit.fn_row_audit();

create table accounting.approval_workflow_steps (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references accounting.approval_workflows(id) on delete cascade,
  step_order        smallint not null check (step_order > 0),
  approver_role_id  uuid not null references core.roles(id) on delete restrict,
  min_amount        numeric(18,2),
  max_amount        numeric(18,2),
  constraint approval_workflow_steps_unique unique (workflow_id, step_order),
  constraint approval_workflow_steps_range check (
    min_amount is null or max_amount is null or min_amount <= max_amount
  )
);

create index idx_approval_workflow_steps_workflow on accounting.approval_workflow_steps(workflow_id);

create trigger trg_audit_approval_workflow_steps after insert or update or delete on accounting.approval_workflow_steps
  for each row execute function audit.fn_row_audit();

create table accounting.voucher_approvals (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references core.companies(id) on delete cascade,
  voucher_type   text not null,
  voucher_id     uuid not null,
  workflow_id    uuid references accounting.approval_workflows(id),
  amount         numeric(18,2) not null default 0,
  current_step   smallint,
  status         text not null default 'pending' check (status in ('pending','approved','rejected','sent_back')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  constraint voucher_approvals_unique unique (voucher_type, voucher_id)
);

create index idx_voucher_approvals_company on accounting.voucher_approvals(company_id);

create table accounting.voucher_approval_actions (
  id                    uuid primary key default gen_random_uuid(),
  voucher_approval_id   uuid not null references accounting.voucher_approvals(id) on delete cascade,
  step_order            smallint,
  action                text not null check (action in ('submit','approve','reject','send_back')),
  actor_id              uuid not null references auth.users(id),
  comment               text,
  acted_at              timestamptz not null default now()
);

create index idx_voucher_approval_actions_approval on accounting.voucher_approval_actions(voucher_approval_id);

-- Submits (or re-submits) a voucher into the approval pipeline. If no active
-- workflow is configured for the voucher type, or no step's amount range
-- matches, the voucher is auto-approved so it can be posted immediately.
create or replace function accounting.fn_start_approval(
  p_company_id uuid,
  p_voucher_type text,
  p_voucher_id uuid,
  p_amount numeric
)
returns accounting.voucher_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workflow accounting.approval_workflows;
  v_step accounting.approval_workflow_steps;
  v_row accounting.voucher_approvals;
begin
  select * into v_workflow from accounting.approval_workflows
  where company_id = p_company_id and voucher_type = p_voucher_type and is_active;

  if v_workflow.id is not null then
    select * into v_step from accounting.approval_workflow_steps
    where workflow_id = v_workflow.id
      and (min_amount is null or p_amount >= min_amount)
      and (max_amount is null or p_amount <= max_amount)
    order by step_order asc
    limit 1;
  end if;

  insert into accounting.voucher_approvals (company_id, voucher_type, voucher_id, workflow_id, amount, current_step, status)
  values (
    p_company_id, p_voucher_type, p_voucher_id, v_workflow.id, p_amount,
    v_step.step_order, case when v_step.id is null then 'approved' else 'pending' end
  )
  on conflict (voucher_type, voucher_id) do update
    set workflow_id = excluded.workflow_id,
        amount = excluded.amount,
        current_step = excluded.current_step,
        status = excluded.status,
        updated_at = now()
  returning * into v_row;

  insert into accounting.voucher_approval_actions (voucher_approval_id, action, actor_id, comment)
  values (
    v_row.id, 'submit', auth.uid(),
    case when v_workflow.id is null then 'No approval workflow configured — auto-approved' end
  );

  return v_row;
end;
$$;

-- Records an approve/reject/send-back decision on the voucher's current
-- step, authorized by matching the caller's roles against that step's
-- approver_role_id, and advances (or closes out) the workflow.
create or replace function accounting.fn_approval_action(
  p_voucher_approval_id uuid,
  p_action text,
  p_comment text default null
)
returns accounting.voucher_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval accounting.voucher_approvals;
  v_step accounting.approval_workflow_steps;
  v_next_step accounting.approval_workflow_steps;
  v_is_authorized boolean;
begin
  if p_action not in ('approve','reject','send_back') then
    raise exception 'Invalid approval action %', p_action;
  end if;

  select * into v_approval from accounting.voucher_approvals where id = p_voucher_approval_id;
  if v_approval.id is null then
    raise exception 'Approval record not found';
  end if;
  if v_approval.status <> 'pending' then
    raise exception 'Voucher is not pending approval (status: %)', v_approval.status;
  end if;

  select * into v_step from accounting.approval_workflow_steps
  where workflow_id = v_approval.workflow_id and step_order = v_approval.current_step;

  select exists (
    select 1 from core.user_roles
    where user_id = auth.uid()
      and company_id = v_approval.company_id
      and role_id = v_step.approver_role_id
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized to act on step % of this approval', v_approval.current_step;
  end if;

  insert into accounting.voucher_approval_actions (voucher_approval_id, step_order, action, actor_id, comment)
  values (v_approval.id, v_approval.current_step, p_action, auth.uid(), p_comment);

  if p_action = 'reject' then
    update accounting.voucher_approvals set status = 'rejected', updated_at = now()
    where id = v_approval.id returning * into v_approval;
  elsif p_action = 'send_back' then
    update accounting.voucher_approvals set status = 'sent_back', current_step = null, updated_at = now()
    where id = v_approval.id returning * into v_approval;
  else
    select * into v_next_step from accounting.approval_workflow_steps
    where workflow_id = v_approval.workflow_id
      and step_order > v_approval.current_step
      and (min_amount is null or v_approval.amount >= min_amount)
      and (max_amount is null or v_approval.amount <= max_amount)
    order by step_order asc
    limit 1;

    if v_next_step.id is null then
      update accounting.voucher_approvals set status = 'approved', current_step = null, updated_at = now()
      where id = v_approval.id returning * into v_approval;
    else
      update accounting.voucher_approvals set current_step = v_next_step.step_order, updated_at = now()
      where id = v_approval.id returning * into v_approval;
    end if;
  end if;

  return v_approval;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table accounting.journal_entries enable row level security;
alter table accounting.journal_entry_lines enable row level security;
alter table accounting.posting_templates enable row level security;
alter table accounting.approval_workflows enable row level security;
alter table accounting.approval_workflow_steps enable row level security;
alter table accounting.voucher_approvals enable row level security;
alter table accounting.voucher_approval_actions enable row level security;

create policy journal_entries_select on accounting.journal_entries
  for select using (company_id = core.current_company_id());
create policy journal_entries_insert on accounting.journal_entries
  for insert with check (
    company_id = core.current_company_id() and core.user_has_permission(voucher_type, 'create')
  );
create policy journal_entries_update on accounting.journal_entries
  for update using (
    company_id = core.current_company_id() and core.user_has_permission(voucher_type, 'edit')
  );

create policy journal_entry_lines_select on accounting.journal_entry_lines
  for select using (
    exists (
      select 1 from accounting.journal_entries je
      where je.id = journal_entry_id and je.company_id = core.current_company_id()
    )
  );
create policy journal_entry_lines_write on accounting.journal_entry_lines
  for all using (
    exists (
      select 1 from accounting.journal_entries je
      where je.id = journal_entry_id
        and je.company_id = core.current_company_id()
        and core.user_has_permission(je.voucher_type, 'edit')
    )
  ) with check (
    exists (
      select 1 from accounting.journal_entries je
      where je.id = journal_entry_id
        and je.company_id = core.current_company_id()
        and core.user_has_permission(je.voucher_type, 'edit')
    )
  );

create policy posting_templates_select on accounting.posting_templates
  for select using (company_id = core.current_company_id());
create policy posting_templates_write on accounting.posting_templates
  for all using (
    company_id = core.current_company_id() and core.user_has_permission('posting_templates', 'edit')
  ) with check (
    company_id = core.current_company_id() and core.user_has_permission('posting_templates', 'edit')
  );

create policy approval_workflows_select on accounting.approval_workflows
  for select using (company_id = core.current_company_id());
create policy approval_workflows_write on accounting.approval_workflows
  for all using (
    company_id = core.current_company_id() and core.user_has_permission('approval_workflows', 'edit')
  ) with check (
    company_id = core.current_company_id() and core.user_has_permission('approval_workflows', 'edit')
  );

create policy approval_workflow_steps_select on accounting.approval_workflow_steps
  for select using (
    workflow_id in (select id from accounting.approval_workflows where company_id = core.current_company_id())
  );
create policy approval_workflow_steps_write on accounting.approval_workflow_steps
  for all using (
    core.user_has_permission('approval_workflows', 'edit')
    and workflow_id in (select id from accounting.approval_workflows where company_id = core.current_company_id())
  ) with check (
    core.user_has_permission('approval_workflows', 'edit')
    and workflow_id in (select id from accounting.approval_workflows where company_id = core.current_company_id())
  );

-- No INSERT/UPDATE policies on voucher_approvals or voucher_approval_actions:
-- both SECURITY DEFINER RPCs above bypass RLS, so fn_start_approval() and
-- fn_approval_action() remain the only way to mutate them.
create policy voucher_approvals_select on accounting.voucher_approvals
  for select using (company_id = core.current_company_id());
create policy voucher_approval_actions_select on accounting.voucher_approval_actions
  for select using (
    voucher_approval_id in (select id from accounting.voucher_approvals where company_id = core.current_company_id())
  );
