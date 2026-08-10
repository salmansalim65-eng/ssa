-- =============================================================================
-- Unified Rent Invoices
-- Consolidates UAE + Pakistan rent invoices into a single reporting/list layer
-- WITHOUT merging the physical tables (they keep their own fields, accounting
-- links, generation logic and RLS). Two additions make one unified list possible:
--   1. A stored invoice_type on each invoice record (PK / HH / UAE) so filtering
--      is reliable and never inferred from a name.
--   2. A lease_type marker on uae_leases so HH leases (created via the HH voucher)
--      are distinguishable from standard UAE leases at invoice-generation time.
-- A security_invoker view (rental.v_rent_invoices) unions both tables for the
-- unified page. No invoice data is duplicated.
-- =============================================================================

-- HH leases are uae_leases created under a shared document number. Mark them so
-- their invoices can inherit invoice_type = 'HH'. Existing rows (none yet) default
-- to 'standard'.
alter table rental.uae_leases
  add column if not exists lease_type text not null default 'standard'
    check (lease_type in ('standard', 'hh'));

-- Stored invoice type on each invoice record. Defaults match the table's origin;
-- UAE generation overrides to 'HH' when the source lease is an HH lease.
alter table rental.uae_rent_invoices
  add column if not exists invoice_type text not null default 'UAE'
    check (invoice_type in ('UAE', 'HH'));

alter table rental.pk_rent_invoices
  add column if not exists invoice_type text not null default 'PK'
    check (invoice_type in ('PK'));

-- Unified read view for the Rent Invoices page. security_invoker so it keeps
-- inheriting RLS from the base tables (same pattern as reporting.v_rental_income).
create or replace view rental.v_rent_invoices as
select
  uri.id            as invoice_id,
  uri.company_id,
  uri.invoice_type,
  'uae'::text       as source,
  uri.voucher_no,
  uri.lease_id,
  ul.tenant_id,
  ul.asset_id,
  t.name            as tenant_name,
  a.asset_code,
  a.asset_name,
  uri.invoice_date,
  uri.due_date,
  uri.period_start,
  uri.period_end,
  uri.amount        as rent_amount,
  0::numeric        as other_charges,
  uri.amount        as total_amount,
  uri.outstanding_balance as outstanding_amount,
  uri.currency_id,
  cur.code          as currency_code,
  cur.symbol        as currency_symbol,
  je.status,
  uri.created_at
from rental.uae_rent_invoices uri
  join rental.uae_leases ul on ul.id = uri.lease_id
  join rental.tenants t on t.id = ul.tenant_id
  join assets.assets a on a.id = ul.asset_id
  join core.currencies cur on cur.id = uri.currency_id
  join accounting.journal_entries je on je.id = uri.journal_entry_id
union all
select
  pri.id            as invoice_id,
  pri.company_id,
  pri.invoice_type,
  'pk'::text        as source,
  pri.voucher_no,
  pri.lease_id,
  pl.tenant_id,
  pl.asset_id,
  t.name            as tenant_name,
  a.asset_code,
  a.asset_name,
  pri.invoice_date,
  pri.due_date,
  null::date        as period_start,
  null::date        as period_end,
  pri.rent_amount   as rent_amount,
  pri.utility_charges as other_charges,
  pri.total_amount  as total_amount,
  pri.outstanding_amount as outstanding_amount,
  pri.currency_id,
  cur.code          as currency_code,
  cur.symbol        as currency_symbol,
  je.status,
  pri.created_at
from rental.pk_rent_invoices pri
  join rental.pk_leases pl on pl.id = pri.lease_id
  join rental.tenants t on t.id = pl.tenant_id
  join assets.assets a on a.id = pl.asset_id
  join core.currencies cur on cur.id = pri.currency_id
  join accounting.journal_entries je on je.id = pri.journal_entry_id;

alter view rental.v_rent_invoices set (security_invoker = on);
