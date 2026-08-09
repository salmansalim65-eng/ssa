-- Admin "delete" for a POSTED rent invoice actually removes it (rent invoices
-- are regenerable from the schedule), rather than leaving a reversed document
-- behind. It reopens the schedule period so it can be re-invoiced, deletes the
-- invoice (PK utility charges cascade), then deletes its journal entry (lines
-- cascade). Refuses when the invoice already has recorded payments.
create or replace function rental.fn_admin_delete_rent_invoice(p_invoice_id uuid, p_country text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_je uuid;
  v_sched uuid;
  v_payments int;
begin
  if not core.is_admin() then
    raise exception 'Only administrators can delete posted invoices';
  end if;

  if p_country = 'uae' then
    select company_id, journal_entry_id, schedule_id into v_company, v_je, v_sched
    from rental.uae_rent_invoices where id = p_invoice_id;
    if v_company is null then raise exception 'Invoice not found'; end if;
    if core.current_company_id() is distinct from v_company then raise exception 'Not authorized for this company'; end if;

    select count(*) into v_payments from rental.uae_rent_payments where invoice_id = p_invoice_id;
    if v_payments > 0 then
      raise exception 'This invoice has recorded payments and cannot be deleted. Remove the payments first.';
    end if;

    if v_sched is not null then
      update rental.uae_payment_schedules set status = 'pending' where id = v_sched;
    end if;
    delete from rental.uae_rent_invoices where id = p_invoice_id;

  elsif p_country = 'pk' then
    select company_id, journal_entry_id, schedule_id into v_company, v_je, v_sched
    from rental.pk_rent_invoices where id = p_invoice_id;
    if v_company is null then raise exception 'Invoice not found'; end if;
    if core.current_company_id() is distinct from v_company then raise exception 'Not authorized for this company'; end if;

    select count(*) into v_payments from rental.pk_rent_payments where invoice_id = p_invoice_id;
    if v_payments > 0 then
      raise exception 'This invoice has recorded payments and cannot be deleted. Remove the payments first.';
    end if;

    if v_sched is not null then
      update rental.pk_payment_schedules set status = 'pending' where id = v_sched;
    end if;
    delete from rental.pk_rent_invoices where id = p_invoice_id;  -- pk_utility_charges cascade

  else
    raise exception 'Unknown invoice type';
  end if;

  if v_je is not null then
    -- Drop any reversal entry pointing at this one first: the reversal_of FK is
    -- ON DELETE SET NULL, and nulling a posted reversal is blocked by the
    -- immutability trigger. A DELETE has no such guard.
    delete from accounting.journal_entries where reversal_of = v_je;
    delete from accounting.journal_entries where id = v_je;  -- journal_entry_lines cascade
  end if;
end;
$function$;

grant execute on function rental.fn_admin_delete_rent_invoice(uuid, text) to authenticated;
