-- Pending migration: run once in Supabase → SQL Editor. Safe to re-run.
--
-- ============ 0100 ============
-- Add a generic "OTHER" account to the "Rental Expenses" group so HH-lease
-- expenses that don't match a named utility (WIFI / DEWA / EMPOWER / ACCESS
-- CARD ...) can still be booked. It then appears in the New HH Lease
-- expense-account dropdown alongside the existing accounts.
--
-- Idempotent: inserts one "OTHER" leaf under each company's Rental Expenses
-- group only when that group has no active child already named "OTHER".

insert into accounting.chart_of_accounts
  (company_id, account_code, account_name, parent_id, account_type, is_group, is_active, created_by)
select
  g.company_id,
  g.account_code || '-OTHER',
  'OTHER',
  g.id,
  g.account_type,
  false,
  true,
  g.created_by
from accounting.chart_of_accounts g
where g.is_group = true
  and g.deleted_at is null
  and g.account_name ~* 'rent[a-z]*\s*expense'   -- matches RENTAL / RENTEL / RENT EXPENSE(S)
  and not exists (
    select 1
    from accounting.chart_of_accounts c
    where c.parent_id = g.id
      and c.deleted_at is null
      and upper(trim(c.account_name)) = 'OTHER'
  )
  and not exists (
    select 1
    from accounting.chart_of_accounts x
    where x.company_id = g.company_id
      and x.account_code = g.account_code || '-OTHER'
  );

-- Verify it landed (optional): should list the new OTHER account.
-- select account_code, account_name from accounting.chart_of_accounts
-- where account_name = 'OTHER' and deleted_at is null;
