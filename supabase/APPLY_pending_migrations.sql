-- Pending fix: run once in Supabase → SQL Editor. Safe to re-run.
--
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
