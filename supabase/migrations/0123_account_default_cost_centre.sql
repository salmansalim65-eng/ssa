-- An account can name the cost centre its postings belong to.
--
-- The cost-centre reports read the cost centre from each LEDGER LINE, which is
-- whatever the voucher carried. Vouchers raised without one — every posting on
-- the investment accounts, for instance — therefore never appear under any cost
-- centre, and the INVESTMENT cost centres read as empty however many entries
-- they really relate to.
--
-- An account may now name a default cost centre. It prefills the cost centre on
-- a voucher, and the cost-centre reports fall back to it for lines that carry
-- none — the same shape as chart_of_accounts.country, which already stands in
-- for a missing cost centre when a balance is attributed to a country.
--
-- It is optional by design: an account with no cost centre of its own leaves it
-- unset and behaves exactly as before.

alter table accounting.chart_of_accounts
  add column if not exists default_cost_center_id uuid
    references accounting.cost_centers(id) on delete set null;

create index if not exists chart_of_accounts_default_cost_center_idx
  on accounting.chart_of_accounts (default_cost_center_id)
  where default_cost_center_id is not null;
