-- =============================================================================
-- Lease enhancements: informational Due Date + Rent Month on both lease
-- types, soft-delete support, and the multi-asset "HH Lease" UAE voucher.
--
--   1. New columns on rental.uae_leases / rental.pk_leases:
--        due_date      informational rent due date (shown, not scheduling)
--        rent_month    free-text billing-month label (e.g. "Aug-2026")
--      UAE-only extras that back the HH Lease voucher grid:
--        remarks       per-line note
--        document_no   HH Lease voucher number grouping the lines
--        document_date HH Lease voucher header date
--
--   2. Soft delete is an UPDATE that stamps deleted_at/by. The existing
--      UPDATE policies only allowed the `edit` permission, so a user with
--      `delete` but not `edit` would be blocked by RLS. Broaden both to
--      accept `edit` OR `delete`.
--
--   3. HH Lease document numbering reuses core.document_sequences (like
--      fn_next_master_code) but is gated on the uae_rent_invoice `create`
--      permission, since HH Lease has no permission module of its own. The
--      voucher_type CHECK is extended to allow the 'hh_lease' sequence key.
-- =============================================================================

-- 1. New informational fields -------------------------------------------------

alter table rental.uae_leases
  add column if not exists due_date      date,
  add column if not exists rent_month    text,
  add column if not exists remarks       text,
  add column if not exists document_no   text,
  add column if not exists document_date date;

alter table rental.pk_leases
  add column if not exists due_date   date,
  add column if not exists rent_month text;

comment on column rental.uae_leases.due_date is
  'Informational rent due date shown on the lease and its invoices; does not drive payment-schedule generation.';
comment on column rental.uae_leases.rent_month is
  'Free-text billing-month label (e.g. "Aug-2026"). Informational.';
comment on column rental.uae_leases.remarks is
  'Free-text note. Populated per asset line when the lease is entered via the HH Lease voucher.';
comment on column rental.uae_leases.document_no is
  'HH Lease voucher number that groups the asset lines entered together (null for single leases created from the standard form).';
comment on column rental.uae_leases.document_date is
  'HH Lease voucher header date (null for single leases).';
comment on column rental.pk_leases.due_date is
  'Informational rent due date shown on the lease and its invoices; does not drive payment-schedule generation.';
comment on column rental.pk_leases.rent_month is
  'Free-text billing-month label (e.g. "Aug-2026"). Informational.';

create index if not exists idx_uae_leases_document_no on rental.uae_leases(company_id, document_no);

-- 2. Let soft-delete (an UPDATE) through for holders of edit OR delete -------

drop policy uae_leases_update on rental.uae_leases;
create policy uae_leases_update on rental.uae_leases
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('uae_rent_invoice', 'edit')
         or core.user_has_permission('uae_rent_invoice', 'delete'))
  );

drop policy pk_leases_update on rental.pk_leases;
create policy pk_leases_update on rental.pk_leases
  for update using (
    company_id = core.current_company_id()
    and (core.user_has_permission('pk_rent_invoice', 'edit')
         or core.user_has_permission('pk_rent_invoice', 'delete'))
  );

-- 3. HH Lease document numbering ---------------------------------------------

-- Allow the 'hh_lease' sequence key in the document_sequences CHECK.
alter table core.document_sequences drop constraint document_sequences_voucher_type_check;

alter table core.document_sequences add constraint document_sequences_voucher_type_check
  check (voucher_type = any (array[
    'purchase_voucher', 'receipt_voucher', 'payment_voucher', 'pdc_payment_voucher',
    'pdc_receipt_voucher', 'cheque_return_voucher', 'journal_voucher', 'jv_maintenance_voucher',
    'opening_balance_voucher', 'uae_rent_invoice', 'pk_rent_invoice', 'asset_sales',
    'assets', 'cost_centers', 'chart_of_accounts', 'hh_lease'
  ]));

-- Next HH Lease document number for a company. Auto-provisions the sequence
-- row on first use (prefix HH), gated on the uae_rent_invoice `create`
-- permission — HH Lease creates UAE leases, so it shares their access rules.
create or replace function rental.fn_next_hh_lease_no(p_company_id uuid)
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
  if not core.user_has_permission('uae_rent_invoice', 'create') then
    raise exception 'Not authorized to create HH leases';
  end if;

  insert into core.document_sequences (company_id, voucher_type, prefix, padding)
  values (p_company_id, 'hh_lease', 'HH', 6)
  on conflict (company_id, voucher_type) do nothing;

  select * into v_seq
  from core.document_sequences
  where company_id = p_company_id and voucher_type = 'hh_lease'
  for update;

  v_number := v_seq.prefix || '-' || lpad(v_seq.next_number::text, v_seq.padding, '0');

  update core.document_sequences
  set next_number = next_number + 1, updated_by = auth.uid(), updated_at = now()
  where id = v_seq.id;

  return v_number;
end;
$$;

comment on function rental.fn_next_hh_lease_no(uuid) is
  'Next HH Lease voucher document number (prefix HH) for a company, reusing core.document_sequences. Gated on uae_rent_invoice.create.';

-- Signed-in users only (matches the 0021 security posture).
grant execute on function rental.fn_next_hh_lease_no(uuid) to authenticated, service_role;
revoke execute on function rental.fn_next_hh_lease_no(uuid) from public, anon;
