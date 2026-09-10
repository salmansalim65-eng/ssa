-- Reuse a voucher number that a deletion freed, instead of skipping past it.
--
-- The numbering functions only ever handed out a counter and bumped it, so
-- deleting a voucher lost its number for good: delete MCJ-000004 and the next
-- multi-currency journal became MCJ-000005, with nothing in between.
--
-- The number issued is now `min(counter, highest number in use + 1)`. Delete the
-- most recent voucher of a type and the next one takes its number back; the
-- counter is pulled down to match, so the two stay in step.
--
-- It deliberately does NOT backfill old holes. These books already carry plenty
-- (receipts start at RCT-000011, invoices run URI-000034..41 then 87, 95), and
-- issuing the lowest free number would number a receipt raised today RCT-000001
-- and file it before twenty older ones. A freed number comes back; history is
-- left as it is.
--
-- Both functions read the numbers actually in use rather than trusting the
-- counter, and take them under the same row lock they already held, so two
-- concurrent callers still cannot be handed the same number.

create or replace function core.fn_next_document_number(p_company_id uuid, p_voucher_type text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_seq core.document_sequences%rowtype;
  v_max int;
  v_next int;
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

  -- v_voucher_register is the one place that resolves a voucher number for every
  -- voucher type in the app, so this needs no per-type table knowledge.
  select max(substring(vr.voucher_no from '([0-9]+)$')::int) into v_max
  from accounting.v_voucher_register vr
  where vr.company_id = p_company_id
    and vr.voucher_type = p_voucher_type
    and vr.voucher_no like v_seq.prefix || '-%';

  v_next := least(v_seq.next_number, coalesce(v_max, 0) + 1);
  v_number := v_seq.prefix || '-' || lpad(v_next::text, v_seq.padding, '0');

  update core.document_sequences
  set next_number = v_next + 1, updated_by = auth.uid(), updated_at = now()
  where id = v_seq.id;

  return v_number;
end;
$function$;

comment on function core.fn_next_document_number(uuid, text) is
  'Issues min(counter, highest number in use + 1), so a number freed by deleting the most recent voucher of its type is reused rather than skipped. Old gaps are left alone.';

-- HH invoice document numbers are their own sequence, on their own table, and
-- deserve the same treatment.
create or replace function rental.fn_next_hh_lease_no(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_seq core.document_sequences%rowtype;
  v_max int;
  v_next int;
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

  select max(substring(ul.document_no from '([0-9]+)$')::int) into v_max
  from rental.uae_leases ul
  where ul.company_id = p_company_id
    and ul.deleted_at is null
    and ul.document_no like v_seq.prefix || '-%';

  v_next := least(v_seq.next_number, coalesce(v_max, 0) + 1);
  v_number := v_seq.prefix || '-' || lpad(v_next::text, v_seq.padding, '0');

  update core.document_sequences
  set next_number = v_next + 1, updated_by = auth.uid(), updated_at = now()
  where id = v_seq.id;

  return v_number;
end;
$function$;
