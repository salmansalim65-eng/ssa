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
  add column if not exists payment_terms text not null default 'monthly'
  check (payment_terms in ('monthly', 'advance'));
