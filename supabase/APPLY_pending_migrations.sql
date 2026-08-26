-- Pending fix: run once in Supabase → SQL Editor. Safe to re-run.
--
-- Combined HH/UAE Rent Invoices created before the due-date fix have their due
-- date set to the period END. The rule is: due date = the month rent STARTS.
-- This sets every combined invoice's due date to its period start so the Rent
-- Balance card attributes it to the correct (start) month. New invoices already
-- do this automatically.
--
-- Only touches combined invoices (no schedule) of type HH/UAE; leaves the normal
-- per-month invoices untouched.

update rental.uae_rent_invoices
set due_date = period_start
where schedule_id is null
  and invoice_type in ('HH', 'UAE')
  and due_date <> period_start;

-- Verify (optional): should now show due_date = period_start for these.
-- select voucher_no, invoice_type, period_start, due_date
-- from rental.uae_rent_invoices
-- where schedule_id is null and invoice_type in ('HH','UAE')
-- order by invoice_date desc;
