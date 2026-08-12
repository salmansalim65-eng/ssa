-- Link an account to the journal entry that posts its opening balance, so the
-- CoA opening-balance field actually affects the ledger. One auto-managed,
-- posted opening-balance entry per account (that account vs an "Opening Balance
-- Equity" contra account); editing the opening balance rewrites it, zeroing it
-- removes it.

alter table accounting.chart_of_accounts
  add column if not exists opening_balance_je_id uuid
    references accounting.journal_entries(id) on delete set null;
