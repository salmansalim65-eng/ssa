-- =============================================================================
-- Fix: soft-deleting a lease failed with "new row violates row-level security
-- policy for table ...". The leases' SELECT policy is `deleted_at IS NULL`, and
-- Postgres enforces that policy against the *new* row version on UPDATE — so
-- the moment the update sets deleted_at to a non-null value the new row is no
-- longer SELECT-visible and the write is rejected. An explicit WITH CHECK on
-- the UPDATE policy does not help (the SELECT policy is what rejects it), and
-- relaxing the SELECT policy would leak soft-deleted rows through the API.
--
-- The clean fix, matching the SECURITY DEFINER convention already used for
-- numbering, is to perform the soft delete inside a definer function that runs
-- as the owner (bypassing RLS) after checking company + the delete permission.
-- =============================================================================

create or replace function rental.fn_delete_uae_lease(p_lease_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select company_id into v_company
  from rental.uae_leases
  where id = p_lease_id and deleted_at is null;

  if v_company is null then
    raise exception 'Lease not found or already deleted';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('uae_rent_invoice', 'delete') then
    raise exception 'Not authorized to delete this lease';
  end if;

  update rental.uae_leases
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_lease_id;
end;
$$;

create or replace function rental.fn_delete_pk_lease(p_lease_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select company_id into v_company
  from rental.pk_leases
  where id = p_lease_id and deleted_at is null;

  if v_company is null then
    raise exception 'Lease not found or already deleted';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;
  if not core.user_has_permission('pk_rent_invoice', 'delete') then
    raise exception 'Not authorized to delete this lease';
  end if;

  update rental.pk_leases
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_lease_id;
end;
$$;

comment on function rental.fn_delete_uae_lease(uuid) is
  'Soft-deletes a UAE lease (stamps deleted_at/by) as a definer, after checking company + uae_rent_invoice.delete. Needed because the deleted_at IS NULL SELECT policy otherwise rejects the update.';
comment on function rental.fn_delete_pk_lease(uuid) is
  'Soft-deletes a Pakistan lease (stamps deleted_at/by) as a definer, after checking company + pk_rent_invoice.delete. Needed because the deleted_at IS NULL SELECT policy otherwise rejects the update.';

grant execute on function rental.fn_delete_uae_lease(uuid) to authenticated, service_role;
grant execute on function rental.fn_delete_pk_lease(uuid) to authenticated, service_role;
revoke execute on function rental.fn_delete_uae_lease(uuid) from public, anon;
revoke execute on function rental.fn_delete_pk_lease(uuid) from public, anon;
