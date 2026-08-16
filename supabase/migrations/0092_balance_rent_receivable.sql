-- Rental receivable = the owner's Balance Rent, not the gross rent.
--
-- A rental invoice's collectible is now Rent − Management (agent share) − Other
-- Expenses (the owner's realised rent). Receipt-voucher allocations settle that
-- Balance Rent, and an invoice is fully settled once receipts reach it. The gross
-- invoice outstanding_balance is left untouched by receipt allocations (kept for
-- the GL / receivable), so we drop that trigger. Over-allocation is prevented in
-- the app (the adjustment dialog caps each bill at its remaining Balance Rent).
--
-- View columns keep the same names/shape:
--   net_amount       = amount − agent_share − other_expenses   (Balance Rent)
--   net_outstanding  = greatest(0, net_amount − receipts_applied)

drop trigger if exists trg_apply_receipt_allocation on rental.receipt_invoice_allocations;

drop view if exists reporting.v_outstanding_rent;
drop view if exists reporting.v_rental_income;

create view reporting.v_rental_income
with (security_invoker = on) as
with uae as (
  select
    uri.company_id,
    'UAE'::text as country,
    uri.id as invoice_id,
    uri.voucher_no,
    a.asset_code,
    a.asset_name,
    t.name as tenant_name,
    uri.invoice_date,
    uri.due_date,
    uri.amount,
    uri.outstanding_balance,
    cur.code as currency_code,
    je.status,
    uri.exchange_rate,
    ul.lease_type,
    t.account_id as tenant_account_id,
    round(uri.amount * (case when ul.lease_type = 'hh' then 0.10 else 0.05 end), 2) as agent_share,
    coalesce(ul.expense_amount, 0)
      + coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.uae_invoice_id = uri.id), 0)
      as other_expenses,
    coalesce((select sum(ra.amount) from rental.receipt_invoice_allocations ra where ra.uae_invoice_id = uri.id), 0)
      as received
  from rental.uae_rent_invoices uri
    join rental.uae_leases ul on ul.id = uri.lease_id
    join assets.assets a on a.id = ul.asset_id
    join rental.tenants t on t.id = ul.tenant_id
    join core.currencies cur on cur.id = uri.currency_id
    join accounting.journal_entries je on je.id = uri.journal_entry_id
  where je.status = 'posted'::text
)
select
  company_id, country, invoice_id, voucher_no, asset_code, asset_name, tenant_name,
  invoice_date, due_date, amount, outstanding_balance, currency_code, status, exchange_rate,
  lease_type,
  agent_share,
  other_expenses,
  (amount - agent_share - other_expenses) as net_amount,
  greatest(0, (amount - agent_share - other_expenses) - received) as net_outstanding,
  tenant_account_id
from uae
union all
select
  pri.company_id,
  'PK'::text as country,
  pri.id as invoice_id,
  pri.voucher_no,
  a.asset_code,
  a.asset_name,
  t.name as tenant_name,
  pri.invoice_date,
  pri.due_date,
  pri.total_amount as amount,
  pri.outstanding_amount as outstanding_balance,
  cur.code as currency_code,
  je.status,
  pri.exchange_rate,
  null::text as lease_type,
  0::numeric as agent_share,
  coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.pk_invoice_id = pri.id), 0) as other_expenses,
  (pri.total_amount
     - coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.pk_invoice_id = pri.id), 0)
  ) as net_amount,
  greatest(0,
    (pri.total_amount
       - coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.pk_invoice_id = pri.id), 0)
    )
    - coalesce((select sum(ra.amount) from rental.receipt_invoice_allocations ra where ra.pk_invoice_id = pri.id), 0)
  ) as net_outstanding,
  t.account_id as tenant_account_id
from rental.pk_rent_invoices pri
  join rental.pk_leases pl on pl.id = pri.lease_id
  join assets.assets a on a.id = pl.asset_id
  join rental.tenants t on t.id = pl.tenant_id
  join core.currencies cur on cur.id = pri.currency_id
  join accounting.journal_entries je on je.id = pri.journal_entry_id
where je.status = 'posted'::text;

-- Outstanding = still-unsettled Balance Rent (mirrors migration 0080's overdue rule).
create view reporting.v_outstanding_rent
with (security_invoker = on) as
select
  *,
  (current_date
     - (date_trunc('month', due_date) + interval '1 month' - interval '1 day')::date
  ) as days_overdue
from reporting.v_rental_income
where net_outstanding > 0;
