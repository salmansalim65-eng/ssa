-- Leases gain an informational "voucher date" — the document date the user
-- records for the lease, shown on the lease detail (and captured on the form).
-- Display-only: it does not change how generated rent invoices are dated.
alter table rental.pk_leases  add column if not exists voucher_date date;
alter table rental.uae_leases add column if not exists voucher_date date;
