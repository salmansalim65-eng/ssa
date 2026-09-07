-- Tenant security deposits are long-term liabilities.
--
-- A deposit is owed back, but not soon: it sits until the tenant leaves, and
-- for a yearly lease that is a year or more away. Holding cash against it made
-- the Cash Flow Forecast's "safe to withdraw" read PKR 3,186,400 lower than the
-- company can actually spare.
--
-- The provision for income tax is deliberately NOT marked: that one does fall
-- due, and the forecast should keep reserving for it.
--
-- The flag is editable per account on the Chart of Accounts screen, so this is
-- a starting position rather than a rule.

update accounting.chart_of_accounts
set is_long_term = true
where account_type = 'liability'
  and deleted_at is null
  and account_name ilike '%SECURITY DEPOSIT%';
