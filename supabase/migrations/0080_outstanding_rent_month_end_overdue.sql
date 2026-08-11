-- Outstanding Rent: rent is overdue only after the end of its due date's month.
--
-- Previously `days_overdue` counted days from the due date itself, so rent read
-- as overdue the day after it fell due. The agreed rule is that rent stays Due
-- through the end of the due date's calendar month and becomes Overdue only once
-- that month has ended (e.g. due 20-08-2026 -> Due through 31-08, Overdue from
-- 01-09). We measure `days_overdue` from the last day of the due month, so it is
-- <= 0 until the month ends and positive once rent is genuinely overdue. This
-- matches the app-side rule in `lib/rental/overdue.ts`.

drop view if exists reporting.v_outstanding_rent;
create or replace view reporting.v_outstanding_rent as
select
  *,
  (current_date
     - (date_trunc('month', due_date) + interval '1 month' - interval '1 day')::date
  ) as days_overdue
from reporting.v_rental_income
where outstanding_balance > 0;

alter view reporting.v_outstanding_rent set (security_invoker = on);
