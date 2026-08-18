-- Accounting period start: the date this company's books begin. Reports use it
-- to avoid showing activity (e.g. "Vacant" months in the Rent Report) for
-- periods before the company existed. Nullable — reports fall back to the
-- earliest lease start when it isn't set.
alter table core.companies
  add column if not exists accounting_period_start date;
