-- Manual ordering for the Chart of Accounts. `sort_order` positions an account
-- among its siblings (accounts sharing the same parent). The tree renders
-- siblings by sort_order in the default "Manual" view; the other sort modes
-- (name/code/balance) are view-only and never write this column. Reordering
-- only changes position — it never touches account_code or accounting history.

alter table accounting.chart_of_accounts
  add column if not exists sort_order integer not null default 0;

-- Seed the manual order from the current display order (account_code within
-- each parent) so the existing arrangement is preserved on first load.
with ordered as (
  select id,
         row_number() over (
           partition by company_id, coalesce(parent_id::text, '__root__')
           order by account_code
         ) - 1 as rn
  from accounting.chart_of_accounts
  where deleted_at is null
)
update accounting.chart_of_accounts c
set sort_order = ordered.rn
from ordered
where ordered.id = c.id;

create index if not exists idx_coa_company_parent_sort
  on accounting.chart_of_accounts (company_id, parent_id, sort_order);
