-- =============================================================================
-- Allow deleting a DRAFT (unposted) UAE / Pakistan rent invoice and its journal
-- entry, and revert the source payment schedule back to 'pending' so it can be
-- re-invoiced. Only drafts can be removed — a posted invoice is part of the
-- ledger (and only posted invoices can carry payments, so a draft never has
-- any). Mirrors the voucher delete definers: checks company + the delete
-- permission + draft status, runs as definer (there is no DELETE RLS path that
-- also flips the schedule). The PK variant additionally removes the invoice's
-- utility-charge lines; the adjusted advance rent is restored automatically
-- because the "remaining advance" is derived from the surviving invoices.
-- =============================================================================

create or replace function rental.fn_delete_draft_uae_rent_invoice(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_je uuid;
  v_status text;
  v_schedule uuid;
begin
  select i.company_id, i.journal_entry_id, i.schedule_id, je.status
    into v_company, v_je, v_schedule, v_status
  from rental.uae_rent_invoices i
  join accounting.journal_entries je on je.id = i.journal_entry_id
  where i.id = p_id;

  if v_company is null then
    raise exception 'Rent invoice not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('uae_rent_invoice', 'delete') then
    raise exception 'Not authorized to delete this invoice';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only draft (unposted) invoices can be deleted';
  end if;

  delete from accounting.voucher_approvals where voucher_type = 'uae_rent_invoice' and voucher_id = p_id;
  delete from rental.uae_rent_invoices where id = p_id;
  delete from accounting.journal_entry_lines where journal_entry_id = v_je;
  delete from accounting.journal_entries where id = v_je;
  if v_schedule is not null then
    update rental.uae_payment_schedules set status = 'pending' where id = v_schedule and status = 'invoiced';
  end if;
end;
$$;

create or replace function rental.fn_delete_draft_pk_rent_invoice(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_je uuid;
  v_status text;
  v_schedule uuid;
begin
  select i.company_id, i.journal_entry_id, i.schedule_id, je.status
    into v_company, v_je, v_schedule, v_status
  from rental.pk_rent_invoices i
  join accounting.journal_entries je on je.id = i.journal_entry_id
  where i.id = p_id;

  if v_company is null then
    raise exception 'Rent invoice not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('pk_rent_invoice', 'delete') then
    raise exception 'Not authorized to delete this invoice';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only draft (unposted) invoices can be deleted';
  end if;

  delete from accounting.voucher_approvals where voucher_type = 'pk_rent_invoice' and voucher_id = p_id;
  delete from rental.pk_utility_charges where invoice_id = p_id;
  delete from rental.pk_rent_invoices where id = p_id;
  delete from accounting.journal_entry_lines where journal_entry_id = v_je;
  delete from accounting.journal_entries where id = v_je;
  if v_schedule is not null then
    update rental.pk_payment_schedules set status = 'pending' where id = v_schedule and status = 'invoiced';
  end if;
end;
$$;

grant execute on function rental.fn_delete_draft_uae_rent_invoice(uuid) to authenticated, service_role;
grant execute on function rental.fn_delete_draft_pk_rent_invoice(uuid) to authenticated, service_role;
