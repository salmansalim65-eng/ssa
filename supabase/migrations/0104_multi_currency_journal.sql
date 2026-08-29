-- =============================================================================
-- Multi-Currency Journal voucher
-- A raw journal where EACH line carries its own currency + exchange rate, so a
-- party account held in AED can be credited in AED while a loan account held in
-- PKR is debited in PKR — the entry balances in the company BASE currency
-- (sum of base debits = sum of base credits, already enforced by
-- accounting.fn_enforce_balanced_entry). accounting.journal_entry_lines already
-- stores per-line currency_id / exchange_rate / base amounts, so this migration
-- only adds the new voucher_type, its header table, numbering and permissions.
-- =============================================================================

-- 1. Allow the new voucher_type value on the constrained tables. -------------
alter table accounting.journal_entries drop constraint if exists journal_entries_voucher_type_check;
alter table accounting.journal_entries add constraint journal_entries_voucher_type_check
  check (voucher_type = any (array[
    'purchase_voucher','receipt_voucher','payment_voucher','pdc_payment_voucher',
    'pdc_receipt_voucher','cheque_return_voucher','journal_voucher',
    'jv_maintenance_voucher','opening_balance_voucher','uae_rent_invoice',
    'pk_rent_invoice','asset_sales','multi_currency_journal'
  ]));

alter table core.document_sequences drop constraint document_sequences_voucher_type_check;
alter table core.document_sequences add constraint document_sequences_voucher_type_check
  check (voucher_type = any (array[
    'purchase_voucher','receipt_voucher','payment_voucher','pdc_payment_voucher',
    'pdc_receipt_voucher','cheque_return_voucher','journal_voucher','jv_maintenance_voucher',
    'opening_balance_voucher','uae_rent_invoice','pk_rent_invoice','asset_sales',
    'assets','cost_centers','chart_of_accounts','hh_lease','multi_currency_journal'
  ]));

-- 2. Header table (voucher_no + narration). The line-level accounting data lives
--    in accounting.journal_entry_lines (one Dr/Cr line per row, each currency). -
create table if not exists accounting.multi_currency_journal_vouchers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies(id) on delete cascade,
  journal_entry_id  uuid not null references accounting.journal_entries(id) on delete restrict,
  voucher_no        text,
  entry_date        date not null,
  narration         text,
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  constraint multi_currency_journal_vouchers_no_unique unique (company_id, voucher_no)
);

create trigger trg_audit_multi_currency_journal_vouchers
  after insert or update or delete on accounting.multi_currency_journal_vouchers
  for each row execute function audit.fn_row_audit();

alter table accounting.multi_currency_journal_vouchers enable row level security;

create policy multi_currency_journal_vouchers_select on accounting.multi_currency_journal_vouchers
  for select using (company_id = core.current_company_id());
create policy multi_currency_journal_vouchers_insert on accounting.multi_currency_journal_vouchers
  for insert with check (
    company_id = core.current_company_id()
    and core.user_has_permission('multi_currency_journal', 'create')
  );
create policy multi_currency_journal_vouchers_update on accounting.multi_currency_journal_vouchers
  for update using (
    company_id = core.current_company_id()
    and (
      core.user_has_permission('multi_currency_journal', 'edit')
      or core.user_has_permission('multi_currency_journal', 'post')
    )
  );

-- 3. Document numbering (prefix MCJ) for every existing company. --------------
insert into core.document_sequences (company_id, voucher_type, prefix, padding, next_number)
select id, 'multi_currency_journal', 'MCJ', 6, 1 from core.companies
on conflict (company_id, voucher_type) do nothing;

-- 4. Permission catalog rows. Admins bypass permission checks; these rows let
--    the permission UI grant the voucher to non-admin users/roles later. -------
insert into core.permissions (module_key, action, label)
select 'multi_currency_journal', a.action, initcap(a.action) || ' multi-currency journal'
from (values ('view'),('create'),('edit'),('delete'),('print'),('export'),('approve'),('reject'),('post')) as a(action)
on conflict (module_key, action) do nothing;

-- 5. Teach the draft + posted delete helpers about the new type. --------------
create or replace function accounting.fn_delete_draft_voucher(p_voucher_type text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_company uuid;
  v_je uuid;
  v_status text;
begin
  v_table := case p_voucher_type
    when 'receipt_voucher' then 'receipt_vouchers'
    when 'payment_voucher' then 'payment_vouchers'
    when 'pdc_payment_voucher' then 'pdc_payment_vouchers'
    when 'pdc_receipt_voucher' then 'pdc_receipt_vouchers'
    when 'cheque_return_voucher' then 'cheque_return_vouchers'
    when 'journal_voucher' then 'journal_vouchers'
    when 'jv_maintenance_voucher' then 'jv_maintenance_vouchers'
    when 'opening_balance_voucher' then 'opening_balance_vouchers'
    when 'multi_currency_journal' then 'multi_currency_journal_vouchers'
    else null
  end;
  if v_table is null then
    raise exception 'Unsupported voucher type %', p_voucher_type;
  end if;

  execute format(
    'select v.company_id, v.journal_entry_id, je.status
       from accounting.%I v
       join accounting.journal_entries je on je.id = v.journal_entry_id
      where v.id = $1', v_table)
    into v_company, v_je, v_status
    using p_id;

  if v_company is null then
    raise exception 'Voucher not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission(p_voucher_type, 'delete') then
    raise exception 'Not authorized to delete this voucher';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only draft (unposted) vouchers can be deleted';
  end if;

  delete from accounting.voucher_approvals where voucher_type = p_voucher_type and voucher_id = p_id;
  execute format('delete from accounting.%I where id = $1', v_table) using p_id;
  delete from accounting.journal_entry_lines where journal_entry_id = v_je;
  delete from accounting.journal_entries where id = v_je;
end;
$$;

grant execute on function accounting.fn_delete_draft_voucher(text, uuid) to authenticated, service_role;

create or replace function accounting.fn_admin_delete_posted_voucher(p_voucher_type text, p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_je uuid;
  v_tbl text;
begin
  if not core.is_admin() then
    raise exception 'Only administrators can delete posted vouchers';
  end if;

  v_tbl := case p_voucher_type
    when 'receipt_voucher' then 'receipt_vouchers'
    when 'payment_voucher' then 'payment_vouchers'
    when 'pdc_payment_voucher' then 'pdc_payment_vouchers'
    when 'pdc_receipt_voucher' then 'pdc_receipt_vouchers'
    when 'cheque_return_voucher' then 'cheque_return_vouchers'
    when 'journal_voucher' then 'journal_vouchers'
    when 'jv_maintenance_voucher' then 'jv_maintenance_vouchers'
    when 'opening_balance_voucher' then 'opening_balance_vouchers'
    when 'purchase_voucher' then 'purchase_vouchers'
    when 'multi_currency_journal' then 'multi_currency_journal_vouchers'
    else null
  end;
  if v_tbl is null then
    raise exception 'Unsupported voucher type %', p_voucher_type;
  end if;

  execute format('select company_id, journal_entry_id from accounting.%I where id = $1', v_tbl)
    into v_company, v_je using p_id;
  if v_company is null then
    raise exception 'Voucher not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;

  if p_voucher_type = 'journal_voucher' then
    update accounting.jv_maintenance_vouchers set original_jv_id = null where original_jv_id = p_id;
  end if;

  execute format('delete from accounting.%I where id = $1', v_tbl) using p_id;

  if v_je is not null then
    delete from accounting.journal_entries where reversal_of = v_je;
    delete from accounting.journal_entries where id = v_je;
  end if;
end;
$function$;

grant execute on function accounting.fn_admin_delete_posted_voucher(text, uuid) to authenticated;
