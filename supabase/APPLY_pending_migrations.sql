-- Pending fixes: run once in Supabase → SQL Editor. Safe to re-run.

------------------------------------------------------------------------------
-- 1) Combined invoice due date = period END
------------------------------------------------------------------------------
-- Set every combined HH/UAE Rent Invoice's due date to its period END, so the
-- whole combined amount is not flagged overdue during the lease (it becomes due
-- when the lease ends). New invoices already do this. Only touches combined
-- invoices (no schedule) of type HH/UAE; leaves the normal per-month invoices
-- untouched.

update rental.uae_rent_invoices
set due_date = period_end
where schedule_id is null
  and invoice_type in ('HH', 'UAE')
  and due_date <> period_end;

------------------------------------------------------------------------------
-- 2) Remove duplicate property leases within a voucher
------------------------------------------------------------------------------
-- A voucher bills each property once. Older data (from an edit that recreated
-- leases without clearing the old ones) could store the same asset twice under
-- one document number, which showed a single invoice as two rows and doubled it
-- in the reports. Keep the earliest lease per (document_no, asset) and
-- soft-delete the rest. Only touches active leases that share a voucher.

with ranked as (
  select
    id,
    row_number() over (
      partition by document_no, asset_id
      order by created_at
    ) as rn
  from rental.uae_leases
  where deleted_at is null
    and document_no is not null
)
update rental.uae_leases l
set deleted_at = now()
from ranked
where ranked.id = l.id
  and ranked.rn > 1;

-- After running this, open each affected invoice and click "Update UAE Rent
-- Invoice" once. That rebuilds its accounting entry at the correct (single)
-- amount, so the ledger and reports match the de-duplicated leases.

------------------------------------------------------------------------------
-- 3) Payment terms on rent invoices (Monthly / Advance)
------------------------------------------------------------------------------
-- The ledger always books the whole rent as ONE entry. Payment terms only
-- change WHEN it falls due in the Rent Balance: 'monthly' spreads it month by
-- month; 'advance' makes the whole amount due in the starting month (paid up
-- front). Default 'monthly' keeps every existing invoice unchanged.

alter table rental.uae_rent_invoices
  add column if not exists payment_terms text not null default 'monthly';

alter table rental.uae_rent_invoices
  drop constraint if exists uae_rent_invoices_payment_terms_check;

alter table rental.uae_rent_invoices
  add constraint uae_rent_invoices_payment_terms_check
  check (payment_terms in ('advance', 'monthly', 'quarterly', 'half_yearly', 'yearly'));

------------------------------------------------------------------------------
-- 4) Admin lease-maintenance helpers (fix "new row violates RLS for uae_leases")
------------------------------------------------------------------------------
-- Editing / deleting a combined voucher retires (and, on edit, re-stamps) its
-- property leases. Doing those as ordinary UPDATEs was rejected by the
-- uae_leases RLS even for admins. These SECURITY DEFINER helpers run the same
-- admin check as the delete function and bypass RLS.

create or replace function rental.fn_admin_soft_delete_leases(p_lease_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not core.is_admin() then raise exception 'Only administrators can modify leases'; end if;
  update rental.uae_leases
  set deleted_at = now(), deleted_by = auth.uid()
  where id = any(p_lease_ids) and company_id = core.current_company_id() and deleted_at is null;
end;
$$;

create or replace function rental.fn_admin_soft_delete_voucher_leases(p_document_no text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not core.is_admin() then raise exception 'Only administrators can modify leases'; end if;
  update rental.uae_leases
  set deleted_at = now(), deleted_by = auth.uid()
  where document_no = p_document_no and company_id = core.current_company_id() and deleted_at is null;
end;
$$;

create or replace function rental.fn_admin_restamp_voucher_leases(p_from_doc text, p_to_doc text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not core.is_admin() then raise exception 'Only administrators can modify leases'; end if;
  update rental.uae_leases
  set document_no = p_to_doc
  where document_no = p_from_doc and company_id = core.current_company_id() and deleted_at is null;
end;
$$;

grant execute on function rental.fn_admin_soft_delete_leases(uuid[]) to authenticated;
grant execute on function rental.fn_admin_soft_delete_voucher_leases(text) to authenticated;
grant execute on function rental.fn_admin_restamp_voucher_leases(text, text) to authenticated;

------------------------------------------------------------------------------
-- 5) Per-property payment terms
------------------------------------------------------------------------------
-- Payment terms move from the invoice to the lease, so one voucher can bill one
-- property in Advance and another Monthly. Ledger still books one entry.

alter table rental.uae_leases
  add column if not exists payment_terms text not null default 'monthly';

alter table rental.uae_leases
  drop constraint if exists uae_leases_payment_terms_check;

alter table rental.uae_leases
  add constraint uae_leases_payment_terms_check
  check (payment_terms in ('advance', 'monthly', 'quarterly', 'half_yearly', 'yearly'));
