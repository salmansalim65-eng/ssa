-- Expose the agent (SAMAD RENT) share and the owner's net rent on the rental
-- income view. The invoice row stores the GROSS rent in `amount` /
-- `outstanding_balance`; the agent share is only split inside the journal
-- (RENT INCOME DXB vs SAMAD RENT), so dashboards that summed `amount` showed
-- gross (e.g. 12000) rather than the owner's net rent (11300).
--
-- Rates mirror lib/rental/lease-accounting.ts:
--   UAE standard lease -> 5% to SAMAD RENT
--   HH lease           -> 10% to SAMAD RENT
--   PK leases          -> no agent share
--
-- Added columns:
--   lease_type       - the UAE lease type (null for PK)
--   agent_share      - agent/commission cut of the gross rent
--   net_amount       - owner's rent for the period  (amount - agent_share)
--   net_outstanding  - owner's still-uncollected rent, net of the agent share,
--                      reduced pro-rata as the tenant pays down the invoice.

create or replace view reporting.v_rental_income
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
    round(uri.amount * (case when ul.lease_type = 'hh' then 0.10 else 0.05 end), 2) as agent_share
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
  (amount - agent_share) as net_amount,
  case
    when amount > 0 then round(outstanding_balance * (amount - agent_share) / amount, 2)
    else outstanding_balance
  end as net_outstanding
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
  pri.total_amount as net_amount,
  pri.outstanding_amount as net_outstanding
from rental.pk_rent_invoices pri
  join rental.pk_leases pl on pl.id = pri.lease_id
  join assets.assets a on a.id = pl.asset_id
  join rental.tenants t on t.id = pl.tenant_id
  join core.currencies cur on cur.id = pri.currency_id
  join accounting.journal_entries je on je.id = pri.journal_entry_id
where je.status = 'posted'::text;
