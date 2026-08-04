-- =============================================================================
-- Master-data auto-code generation (Assets, Cost Centers, Chart of Accounts)
-- was broken by two problems that only surfaced once accounts started using it:
--
--   1. core.fn_next_master_code (added in 0020) was missing on the deployed
--      project -- PostgREST returned "Could not find the function
--      core.fn_next_master_code(...) in the schema cache". Re-asserted here with
--      `create or replace` so the repo and the database agree regardless of how
--      0020 was (partially) applied.
--
--   2. core.document_sequences.voucher_type carries a CHECK constraint that only
--      allows real voucher types. 0020 reused this table as a generic
--      (company, sequence_key) counter for master data on the assumption the
--      column was unconstrained free text -- it is not, so inserting a sequence
--      row for 'assets' / 'cost_centers' / 'chart_of_accounts' failed the CHECK.
--      The allowed set is extended below to include the master module keys
--      (which double as their permission module_key).
-- =============================================================================

-- 1. Ensure the generic master-code generator exists.
create or replace function core.fn_next_master_code(
  p_company_id uuid,
  p_module_key text,
  p_default_prefix text,
  p_default_padding smallint default 6
)
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
  if not core.user_has_permission(p_module_key, 'create') then
    raise exception 'Not authorized to create %', p_module_key;
  end if;

  insert into core.document_sequences (company_id, voucher_type, prefix, padding)
  values (p_company_id, p_module_key, p_default_prefix, p_default_padding)
  on conflict (company_id, voucher_type) do nothing;

  select * into v_seq
  from core.document_sequences
  where company_id = p_company_id and voucher_type = p_module_key
  for update;

  v_number := v_seq.prefix || '-' || lpad(v_seq.next_number::text, v_seq.padding, '0');

  update core.document_sequences
  set next_number = next_number + 1, updated_by = auth.uid(), updated_at = now()
  where id = v_seq.id;

  return v_number;
end;
$$;

comment on function core.fn_next_master_code(uuid, text, text, smallint) is
  'Generic next-code generator for master data (Assets, Cost Centers, Chart of Accounts, ...), reusing core.document_sequences. p_module_key doubles as the permission module_key checked against user_has_permission(..., ''create'').';

-- Business RPC: keep it callable by signed-in users only (matches 0021).
grant execute on function core.fn_next_master_code(uuid, text, text, smallint) to authenticated, service_role;
revoke execute on function core.fn_next_master_code(uuid, text, text, smallint) from public, anon;

-- 2. Allow the master module keys in the document_sequences voucher_type CHECK.
alter table core.document_sequences drop constraint document_sequences_voucher_type_check;

alter table core.document_sequences add constraint document_sequences_voucher_type_check
  check (voucher_type = any (array[
    'purchase_voucher', 'receipt_voucher', 'payment_voucher', 'pdc_payment_voucher',
    'pdc_receipt_voucher', 'cheque_return_voucher', 'journal_voucher', 'jv_maintenance_voucher',
    'opening_balance_voucher', 'uae_rent_invoice', 'pk_rent_invoice', 'asset_sales',
    'assets', 'cost_centers', 'chart_of_accounts'
  ]));
