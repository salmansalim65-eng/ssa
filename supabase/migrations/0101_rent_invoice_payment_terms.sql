-- Payment terms on a combined rent invoice.
--
-- The ledger always books the whole rent as ONE journal entry. Payment terms
-- only change WHEN the amount falls due in the Rent Balance:
--   monthly  → the amount is due month-by-month across the lease period
--   advance  → the whole amount is due in the starting month (paid up front)
--
-- Default 'monthly' keeps every existing invoice behaving exactly as before.

alter table rental.uae_rent_invoices
  add column if not exists payment_terms text not null default 'monthly'
  check (payment_terms in ('monthly', 'advance'));
