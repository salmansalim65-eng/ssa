-- Expose each rent invoice's booking exchange_rate on the rental reporting views
-- so the Rental Income / Outstanding Rent reports can convert amounts to base
-- using the RATE THAT WAS ACTUALLY BOOKED (base = document_amount * exchange_rate)
-- rather than a single report-date rate. exchange_rate is the document->base
-- factor, matching journal_entries.exchange_rate and the voucher engine.
--
-- exchange_rate is APPENDED as the last column of v_rental_income so the
-- create-or-replace stays valid (existing columns keep their names/order).
-- v_outstanding_rent selects * from v_rental_income, so it is recreated to pick
-- the new column up. Both stay security_invoker to keep inheriting RLS.

create or replace view reporting.v_rental_income as
select
  uri.company_id, 'UAE'::text as country, uri.id as invoice_id, uri.voucher_no,
  a.asset_code, a.asset_name, t.name as tenant_name,
  uri.invoice_date, uri.due_date, uri.amount, uri.outstanding_balance,
  cur.code as currency_code, je.status,
  uri.exchange_rate
from rental.uae_rent_invoices uri
join rental.uae_leases ul on ul.id = uri.lease_id
join assets.assets a on a.id = ul.asset_id
join rental.tenants t on t.id = ul.tenant_id
join core.currencies cur on cur.id = uri.currency_id
join accounting.journal_entries je on je.id = uri.journal_entry_id
where je.status = 'posted'
union all
select
  pri.company_id, 'PK'::text as country, pri.id as invoice_id, pri.voucher_no,
  a.asset_code, a.asset_name, t.name as tenant_name,
  pri.invoice_date, pri.due_date, pri.total_amount as amount, pri.outstanding_amount as outstanding_balance,
  cur.code as currency_code, je.status,
  pri.exchange_rate
from rental.pk_rent_invoices pri
join rental.pk_leases pl on pl.id = pri.lease_id
join assets.assets a on a.id = pl.asset_id
join rental.tenants t on t.id = pl.tenant_id
join core.currencies cur on cur.id = pri.currency_id
join accounting.journal_entries je on je.id = pri.journal_entry_id
where je.status = 'posted';

alter view reporting.v_rental_income set (security_invoker = on);

-- Recreate so its `select *` re-expands to include exchange_rate.
drop view if exists reporting.v_outstanding_rent;
create or replace view reporting.v_outstanding_rent as
select *, (current_date - due_date) as days_overdue
from reporting.v_rental_income
where outstanding_balance > 0;

alter view reporting.v_outstanding_rent set (security_invoker = on);
