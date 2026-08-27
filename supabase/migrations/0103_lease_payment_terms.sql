-- Per-property payment terms.
--
-- Payment terms move from the invoice (one per voucher) to the lease (one per
-- property), so a single voucher can bill one property in Advance and another
-- Monthly. The ledger still books the whole voucher as ONE journal entry; the
-- terms only change WHEN each property's rent falls due in the Rent Balance.
--
-- Default 'monthly' keeps existing leases unchanged.

alter table rental.uae_leases
  add column if not exists payment_terms text not null default 'monthly';

alter table rental.uae_leases
  drop constraint if exists uae_leases_payment_terms_check;

alter table rental.uae_leases
  add constraint uae_leases_payment_terms_check
  check (payment_terms in ('advance', 'monthly', 'quarterly', 'half_yearly', 'yearly'));
