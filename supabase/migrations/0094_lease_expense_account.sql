-- HH lease expenses become real ledger postings.
--
-- Each HH-lease expense is now an EXPENSE ACCOUNT (chosen from the Chart of
-- Accounts group "Rental Expenses") plus a monthly amount. When an HH rent
-- invoice posts, each expense books Dr <expense account> / Cr <tenant> — the
-- same shape as the agent share — so the expense hits the P&L and reduces the
-- tenant's receivable. HH leases only (UAE/PK leases are unaffected).
--
-- The Rent Balance report keeps summing rental.lease_expenses.amount into its
-- Other Expenses column (view unchanged), so no reporting migration is needed.

alter table rental.lease_expenses
  add column if not exists account_id uuid references accounting.chart_of_accounts(id);

-- `name` is now optional (the expense is identified by its account); keep the
-- column for any legacy free-text rows.
alter table rental.lease_expenses
  alter column name drop not null;

create index if not exists idx_lease_expenses_account on rental.lease_expenses(account_id);
