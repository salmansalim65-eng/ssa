-- Admin lease-maintenance helpers for the combined rent-invoice flows.
--
-- Editing or deleting a combined voucher has to retire (soft-delete) its
-- property leases and, on edit, re-stamp the rebuilt voucher's leases with the
-- original document number. Doing those as ordinary UPDATEs goes through the
-- uae_leases RLS policy, which was rejecting them ("new row violates row-level
-- security policy for table uae_leases") even for administrators. These
-- SECURITY DEFINER helpers run the same admin check the delete function already
-- uses and bypass RLS, exactly like fn_admin_delete_rent_invoice.

-- Soft-delete a specific set of leases (used by the edit flow to retire the old
-- voucher's leases after the rebuild).
create or replace function rental.fn_admin_soft_delete_leases(p_lease_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not core.is_admin() then
    raise exception 'Only administrators can modify leases';
  end if;
  update rental.uae_leases
  set deleted_at = now(), deleted_by = auth.uid()
  where id = any(p_lease_ids)
    and company_id = core.current_company_id()
    and deleted_at is null;
end;
$$;

-- Soft-delete every active lease of a voucher (used when deleting a combined
-- invoice so its properties don't linger in the lists and reports).
create or replace function rental.fn_admin_soft_delete_voucher_leases(p_document_no text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not core.is_admin() then
    raise exception 'Only administrators can modify leases';
  end if;
  update rental.uae_leases
  set deleted_at = now(), deleted_by = auth.uid()
  where document_no = p_document_no
    and company_id = core.current_company_id()
    and deleted_at is null;
end;
$$;

-- Re-stamp a rebuilt voucher's active leases with the original document number
-- (used by the edit flow so the document stays the same to the user).
create or replace function rental.fn_admin_restamp_voucher_leases(p_from_doc text, p_to_doc text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not core.is_admin() then
    raise exception 'Only administrators can modify leases';
  end if;
  update rental.uae_leases
  set document_no = p_to_doc
  where document_no = p_from_doc
    and company_id = core.current_company_id()
    and deleted_at is null;
end;
$$;

grant execute on function rental.fn_admin_soft_delete_leases(uuid[]) to authenticated;
grant execute on function rental.fn_admin_soft_delete_voucher_leases(text) to authenticated;
grant execute on function rental.fn_admin_restamp_voucher_leases(text, text) to authenticated;
