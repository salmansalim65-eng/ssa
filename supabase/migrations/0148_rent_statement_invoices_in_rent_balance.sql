-- A rent invoice raised from an agent's statement has no lease behind it: the
-- letting IS the statement line (0147). v_rental_income joined uae_leases
-- INNER, so every such invoice fell out of the Rent Balance, the Outstanding
-- Rent report and the receipt allocation list — the agent owed money the
-- reports could not see.
--
-- Two changes:
--   1. The invoice carries its own management cut and the utilities the agent
--      deducted. Derived figures (amount x 10%) cannot speak for a statement,
--      where the agent's own cut and his DEWA/WiFi bills are given to us.
--   2. The UAE branch joins the lease LEFT, and falls back to the statement
--      line for the property, the tenant and those two amounts.

alter table rental.uae_rent_invoices
  add column if not exists management_amount numeric(14, 2),
  add column if not exists other_expenses numeric(14, 2);

comment on column rental.uae_rent_invoices.management_amount is
  'The agent''s cut on this bill, when it is given to us rather than derived (rent statements). NULL for lease invoices, where it is amount x the lease rate.';
comment on column rental.uae_rent_invoices.other_expenses is
  'Utilities the agent paid on our behalf and deducted from this bill, when given to us. NULL for lease invoices, where they come from lease_expenses.';

create or replace view reporting.v_rental_income as
with uae as (
  select
    uri.company_id,
    'UAE'::text as country,
    uri.id as invoice_id,
    uri.voucher_no,
    coalesce(a.asset_code, cc.code) as asset_code,
    coalesce(a.asset_name, cc.name) as asset_name,
    coalesce(t.name, agent.account_name) as tenant_name,
    uri.invoice_date,
    uri.due_date,
    uri.amount,
    uri.outstanding_balance,
    cur.code as currency_code,
    je.status,
    uri.exchange_rate,
    coalesce(ul.lease_type, case when rsl.line_type = 'short_term' then 'hh' else 'long' end) as lease_type,
    coalesce(t.account_id, rs.agent_account_id) as tenant_account_id,
    -- Given on a statement; derived from the lease rate otherwise.
    coalesce(
      uri.management_amount,
      round(uri.amount * case when ul.lease_type = 'hh' then 0.10 else 0.05 end, 2)
    ) as agent_share,
    coalesce(
      uri.other_expenses,
      coalesce(ul.expense_amount, 0::numeric)
        + case
            when uri.schedule_id is null and ul.document_no is not null then coalesce((
              select sum(le.amount)
              from rental.lease_expenses le
              join rental.uae_leases ul2 on ul2.id = le.lease_id and ul2.deleted_at is null
              where ul2.document_no = ul.document_no), 0::numeric)
            else coalesce((
              select sum(le.amount)
              from rental.lease_expenses le
              where le.lease_id = ul.id), 0::numeric)
          end
        + coalesce((
            select sum(pe.amount)
            from rental.payment_invoice_expenses pe
            where pe.uae_invoice_id = uri.id), 0::numeric)
    ) as other_expenses,
    coalesce((
      select sum(ra.amount)
      from rental.receipt_invoice_allocations ra
      where ra.uae_invoice_id = uri.id), 0::numeric) as received,
    coalesce((
      select sum(case when ja.direction = 'increase' then ja.amount else -ja.amount end)
      from rental.journal_invoice_allocations ja
      where ja.uae_invoice_id = uri.id), 0::numeric) as jv_adjustment
  from rental.uae_rent_invoices uri
    left join rental.uae_leases ul on ul.id = uri.lease_id
    left join rental.rent_statement_lines rsl on rsl.id = uri.rent_statement_line_id
    left join rental.rent_statements rs on rs.id = rsl.statement_id
    left join accounting.cost_centers cc on cc.id = rsl.cost_center_id
    left join accounting.chart_of_accounts agent on agent.id = rs.agent_account_id
    left join assets.assets a on a.id = coalesce(ul.asset_id, cc.asset_id)
    left join rental.tenants t on t.id = ul.tenant_id
    join core.currencies cur on cur.id = uri.currency_id
    join accounting.journal_entries je on je.id = uri.journal_entry_id
  where je.status = 'posted'
    -- A lease invoice with no lease is an orphan, not a statement bill.
    and (uri.lease_id is not null or uri.rent_statement_line_id is not null)
)
select
  uae.company_id,
  uae.country,
  uae.invoice_id,
  uae.voucher_no,
  uae.asset_code,
  uae.asset_name,
  uae.tenant_name,
  uae.invoice_date,
  uae.due_date,
  uae.amount,
  uae.outstanding_balance,
  uae.currency_code,
  uae.status,
  uae.exchange_rate,
  uae.lease_type,
  uae.agent_share,
  uae.other_expenses,
  uae.amount - uae.agent_share - uae.other_expenses as net_amount,
  greatest(0::numeric, uae.amount - uae.agent_share - uae.other_expenses + uae.jv_adjustment - uae.received) as net_outstanding,
  uae.tenant_account_id
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
  coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.pk_invoice_id = pri.id), 0::numeric) as other_expenses,
  pri.total_amount - coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.pk_invoice_id = pri.id), 0::numeric) as net_amount,
  greatest(0::numeric,
    pri.total_amount
    - coalesce((select sum(pe.amount) from rental.payment_invoice_expenses pe where pe.pk_invoice_id = pri.id), 0::numeric)
    + coalesce((select sum(case when ja.direction = 'increase' then ja.amount else -ja.amount end) from rental.journal_invoice_allocations ja where ja.pk_invoice_id = pri.id), 0::numeric)
    - coalesce((select sum(ra.amount) from rental.receipt_invoice_allocations ra where ra.pk_invoice_id = pri.id), 0::numeric)
  ) as net_outstanding,
  t.account_id as tenant_account_id
from rental.pk_rent_invoices pri
  join rental.pk_leases pl on pl.id = pri.lease_id
  join assets.assets a on a.id = pl.asset_id
  join rental.tenants t on t.id = pl.tenant_id
  join core.currencies cur on cur.id = pri.currency_id
  join accounting.journal_entries je on je.id = pri.journal_entry_id
where je.status = 'posted';
