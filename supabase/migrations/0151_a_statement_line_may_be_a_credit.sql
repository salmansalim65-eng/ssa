-- A statement line can be worth less than nothing, and the books must say so.
--
-- October's sheet lists 213 SHAMAL with no rent and 890 of DEWA and internet
-- against it: the unit stood empty, we still paid its utilities, and the agent
-- deducts them from what he owes. Three lines like that on one sheet, 2,451 in
-- all. The journal entry had them right — the agent was debited 7,989, the
-- sheet's own net — but no BILL could be raised for them, because an invoice
-- has to be worth more than nothing:
--
--   CHECK (amount > 0)
--
-- So three of six bills were refused, and every report built on invoices read
-- 10,440 where the ledger said 7,989.
--
-- Two changes, and nothing else needs to know:
--
-- 1. An invoice may be raised for nothing. The rent is nil; the deduction on it
--    is real, and it is what makes the bill a credit.
--
-- 2. A statement bill's outstanding is no longer floored at zero. The floor is
--    right for a lease invoice, which cannot be worth less than nothing, and
--    wrong for a statement line, whose own sheet states a negative net. A
--    credit now shows as a credit, and the bills come back to the ledger.

alter table rental.uae_rent_invoices drop constraint if exists uae_rent_invoices_amount_check;
alter table rental.uae_rent_invoices add constraint uae_rent_invoices_amount_check
  check (amount >= 0);

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
    -- A statement line may be a credit; a lease invoice may not.
    (uri.rent_statement_line_id is not null) as from_statement,
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
  case
    when uae.from_statement
      then uae.amount - uae.agent_share - uae.other_expenses + uae.jv_adjustment - uae.received
    else greatest(0::numeric, uae.amount - uae.agent_share - uae.other_expenses + uae.jv_adjustment - uae.received)
  end as net_outstanding,
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

-- A credit is as outstanding as a debt: it belongs in the list a receipt is
-- adjusted against, or the agent's payment can never be made to balance.
create or replace view reporting.v_outstanding_rent as
select company_id, country, invoice_id, voucher_no, asset_code, asset_name, tenant_name,
       invoice_date, due_date, amount, outstanding_balance, currency_code, status, exchange_rate,
       lease_type, agent_share, other_expenses, net_amount, net_outstanding, tenant_account_id,
       current_date - (date_trunc('month', due_date::timestamptz) + interval '1 mon' - interval '1 day')::date as days_overdue
from reporting.v_rental_income
where net_outstanding <> 0::numeric;
