-- Payment terms on a combined rent invoice.
--
-- The ledger always books the whole rent as ONE journal entry. Payment terms
-- only change WHEN the amount falls due in the Rent Balance: the lease period is
-- split into instalments and each instalment falls due at the start of its block.
--   advance     → the whole amount up front (one instalment)
--   monthly     → every month
--   quarterly   → every 3 months
--   half_yearly → every 6 months
--   yearly      → every 12 months
--
-- Default 'monthly' keeps every existing invoice behaving exactly as before.

alter table rental.uae_rent_invoices
  add column if not exists payment_terms text not null default 'monthly';

-- Refresh the allowed set (safe whether the column is new or an earlier version
-- that only permitted monthly/advance).
alter table rental.uae_rent_invoices
  drop constraint if exists uae_rent_invoices_payment_terms_check;

alter table rental.uae_rent_invoices
  add constraint uae_rent_invoices_payment_terms_check
  check (payment_terms in ('advance', 'monthly', 'quarterly', 'half_yearly', 'yearly'));
