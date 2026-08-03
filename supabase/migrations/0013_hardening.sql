-- =============================================================================
-- Phase 14: Hardening
-- Cross-tenant privilege-escalation fixes found during the security review
-- (SECURITY DEFINER functions that trusted a caller-supplied p_company_id
-- without verifying the caller actually belongs to it — exploitable by
-- calling these functions directly via the PostgREST RPC endpoint, bypassing
-- the Next.js app entirely, since every schema the app queries is an exposed
-- API schema), one RLS gap that caused a legitimate cross-voucher-type
-- workflow to silently no-op, and indexes the Phase 12 reporting views scan
-- by company/date that nothing had covered yet.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. core.fn_set_base_currency — also called mid-transaction by
-- fn_bootstrap_company for a brand-new company, before the caller's JWT
-- reflects it, so core.current_company_id() cannot be trusted here (it
-- would still resolve to the user's previously active company, if any).
-- Use company membership instead, which fn_bootstrap_company already
-- establishes (core.user_companies insert) before this runs.
-- -----------------------------------------------------------------------------

create or replace function core.fn_set_base_currency(p_company_id uuid, p_currency_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from core.user_companies where user_id = auth.uid() and company_id = p_company_id
  ) then
    raise exception 'Not authorized for company %', p_company_id;
  end if;

  update core.company_currencies
  set is_base_currency = false, updated_by = auth.uid(), updated_at = now()
  where company_id = p_company_id and is_base_currency;

  insert into core.company_currencies (company_id, currency_id, is_base_currency, is_active)
  values (p_company_id, p_currency_id, true, true)
  on conflict (company_id, currency_id)
    do update set is_base_currency = true, is_active = true, updated_by = auth.uid(), updated_at = now();
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. core.fn_exchange_rate_to_base — only ever called for the caller's own
-- active company (voucher creation), so a strict equality check is safe.
-- -----------------------------------------------------------------------------

create or replace function core.fn_exchange_rate_to_base(
  p_company_id uuid,
  p_currency_id uuid,
  p_as_of_date date default current_date
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_base boolean;
  v_rate numeric(18,6);
begin
  if core.current_company_id() is distinct from p_company_id then
    raise exception 'Not authorized for company %', p_company_id;
  end if;

  select is_base_currency into v_is_base
  from core.company_currencies
  where company_id = p_company_id and currency_id = p_currency_id;

  if v_is_base then
    return 1;
  end if;

  select rate_to_base into v_rate
  from core.exchange_rates
  where company_id = p_company_id
    and currency_id = p_currency_id
    and rate_date <= p_as_of_date
  order by rate_date desc
  limit 1;

  if v_rate is null then
    raise exception 'No exchange rate available for currency % on or before %', p_currency_id, p_as_of_date;
  end if;

  return v_rate;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. core.fn_next_document_number — only ever called right after the app
-- layer's own requirePermission(voucherType, 'post') check (postVoucher in
-- lib/vouchers/engine.ts), but that check is bypassed entirely by calling
-- this RPC directly, so it's re-asserted here too.
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
  if core.current_company_id() is distinct from p_company_id then
    raise exception 'Not authorized for company %', p_company_id;
  end if;
  if not core.user_has_permission(p_voucher_type, 'post') then
    raise exception 'Not authorized to post voucher type %', p_voucher_type;
  end if;

  select * into v_seq
  from core.document_sequences
  where company_id = p_company_id and voucher_type = p_voucher_type
  for update;

  if not found then
    raise exception 'No document sequence configured for voucher type %', p_voucher_type;
  end if;

  v_number := v_seq.prefix || '-' || lpad(v_seq.next_number::text, v_seq.padding, '0');

  update core.document_sequences
  set next_number = next_number + 1, updated_by = auth.uid(), updated_at = now()
  where id = v_seq.id;

  return v_number;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. accounting.fn_start_approval — same reasoning: the app layer requires
-- 'edit' on the voucher type before calling this (submitVoucher in
-- shared-actions.ts), re-asserted here so a direct RPC call can't submit
-- another company's voucher into its own approval pipeline.
-- -----------------------------------------------------------------------------

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
  if core.current_company_id() is distinct from p_company_id then
    raise exception 'Not authorized for company %', p_company_id;
  end if;
  if not core.user_has_permission(p_voucher_type, 'edit') then
    raise exception 'Not authorized to submit voucher type %', p_voucher_type;
  end if;

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

-- -----------------------------------------------------------------------------
-- 5. RLS gap: postChequeReturnVoucher (Phase 5) flips the original PDC
-- voucher's pdc_status to 'returned' after posting the cheque return, but
-- the PDC tables' update policies only accepted the PDC voucher's own
-- edit/post permission — a caller who can post cheque returns but wasn't
-- separately granted edit/post on pdc_payment_voucher / pdc_receipt_voucher
-- had that update silently blocked by RLS (no error — the UPDATE just
-- matched zero rows), leaving the cheque's status stuck at 'pending'
-- forever even though the return voucher posted successfully.
-- -----------------------------------------------------------------------------

drop policy pdc_payment_vouchers_update on accounting.pdc_payment_vouchers;
create policy pdc_payment_vouchers_update on accounting.pdc_payment_vouchers
  for update using (
    company_id = core.current_company_id()
    and (
      core.user_has_permission('pdc_payment_voucher', 'edit')
      or core.user_has_permission('pdc_payment_voucher', 'post')
      or core.user_has_permission('cheque_return_voucher', 'post')
    )
  );

drop policy pdc_receipt_vouchers_update on accounting.pdc_receipt_vouchers;
create policy pdc_receipt_vouchers_update on accounting.pdc_receipt_vouchers
  for update using (
    company_id = core.current_company_id()
    and (
      core.user_has_permission('pdc_receipt_voucher', 'edit')
      or core.user_has_permission('pdc_receipt_voucher', 'post')
      or core.user_has_permission('cheque_return_voucher', 'post')
    )
  );

-- -----------------------------------------------------------------------------
-- 6. RLS gap: core.attachments is polymorphic (entity_type/entity_id) and
-- its insert/delete policies only ever checked company_id — any
-- authenticated user of a company, regardless of role or granted
-- permissions, could upload or permanently delete any attachment,
-- including title deeds and purchase agreements. Mirrors the entity_type
-- -> permission module mapping the app layer now also enforces
-- (features/attachments/actions.ts) so the same rule holds for anyone
-- calling the REST API directly, bypassing the Next.js server actions.
-- -----------------------------------------------------------------------------

drop policy attachments_insert on core.attachments;
create policy attachments_insert on core.attachments
  for insert with check (
    company_id = core.current_company_id()
    and core.user_has_permission(case entity_type when 'asset' then 'assets' else entity_type end, 'edit')
  );

drop policy attachments_delete on core.attachments;
create policy attachments_delete on core.attachments
  for update using (
    company_id = core.current_company_id()
    and core.user_has_permission(case entity_type when 'asset' then 'assets' else entity_type end, 'edit')
  );

-- -----------------------------------------------------------------------------
-- 7. Performance: indexes the Phase 12 reporting views scan by company +
-- date that nothing had covered (each table only had FK-lookup indexes for
-- its own detail screens, not the company/date filters reports apply).
-- -----------------------------------------------------------------------------

create index idx_journal_entries_company_status_date
  on accounting.journal_entries(company_id, status, entry_date)
  where status = 'posted';

create index idx_chart_of_accounts_cash on accounting.chart_of_accounts(company_id) where is_cash;
create index idx_chart_of_accounts_bank on accounting.chart_of_accounts(company_id) where is_bank;

create index idx_purchase_vouchers_company_date on accounting.purchase_vouchers(company_id, purchase_date);
create index idx_asset_sales_company_date on assets.asset_sales(company_id, sale_date);
create index idx_uae_rent_invoices_company_date on rental.uae_rent_invoices(company_id, invoice_date);
create index idx_pk_rent_invoices_company_date on rental.pk_rent_invoices(company_id, invoice_date);
