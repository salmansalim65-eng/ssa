-- =============================================================================
-- 1. Auto-generated codes for master data (Assets, Cost Centers), mirroring
--    the existing voucher-numbering pattern (core.fn_next_document_number)
--    rather than inventing a new mechanism. Reuses core.document_sequences
--    as a generic (company, sequence_key) -> next-number counter -- its
--    `voucher_type` column is plain text with no check constraint tying it
--    to real voucher types, so master "types" (here: 'assets', 'cost_centers'
--    -- deliberately the same strings as their permission module_key, so one
--    parameter serves both the sequence lookup and the authorization check)
--    live in the same table without colliding with real voucher rows.
--
--    Unlike fn_next_document_number, this auto-provisions a sensible default
--    sequence row on first use instead of requiring an admin to configure it
--    first via Document Sequences -- master codes should just work out of
--    the box; the prefix/padding stay admin-adjustable later by editing that
--    same document_sequences row if ever needed.
-- =============================================================================

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
  'Generic next-code generator for master data (Assets, Cost Centers, ...), reusing core.document_sequences. p_module_key doubles as the permission module_key checked against user_has_permission(..., ''create'').';

grant execute on function core.fn_next_master_code(uuid, text, text, smallint) to anon, authenticated, service_role;

-- =============================================================================
-- 2. New Asset fields.
-- =============================================================================

alter table assets.assets
  add column area_sqft numeric(18,2),
  add column service_charges_rate numeric(18,2),
  add column title_deed_value numeric(18,2),
  add column estimated_rent numeric(18,2),
  add column currency_id uuid references core.currencies(id),
  add column group_cost_center_id uuid references accounting.cost_centers(id) on delete set null;

comment on column assets.assets.area_sqft is
  'Physical size in square feet -- distinct from the free-text `area` column, which holds a locality/neighbourhood name.';
comment on column assets.assets.group_cost_center_id is
  'Optional link to another (typically non-asset-tied) cost center for grouping/allocation, e.g. a shared building or head-office overhead center. Independent of the dedicated 1:1 cost center every asset already gets auto-created via trg_create_cost_center_for_asset.';
