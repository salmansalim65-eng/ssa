-- Rent-invoice journal lines (PK and UAE) were posted without a cost centre, so
-- RENT INCOME and the tenant receivable carried no country attribution. In the
-- reporting view their cost_center_country was null, which hid them from any
-- country-filtered report (Trial Balance / Balance Sheet / P&L / General Ledger
-- with Pakistan selected).
--
-- Going forward the invoice generators stamp the leased asset's cost centre on
-- every line; this migration backfills the already-posted lines to match.
--
-- The lines belong to posted entries, which a guard trigger normally protects
-- from any change. This is a one-time attribution correction (cost centre only,
-- amounts untouched), so the guard is disabled for the update and re-enabled
-- immediately after.
alter table accounting.journal_entry_lines disable trigger trg_prevent_posted_line_update;

with inv as (
  select je.id as je_id, l.asset_id
  from accounting.journal_entries je
    join rental.pk_rent_invoices pk on pk.journal_entry_id = je.id
    join rental.pk_leases l on l.id = pk.lease_id
  where je.voucher_type = 'pk_rent_invoice'
  union all
  select je.id, l.asset_id
  from accounting.journal_entries je
    join rental.uae_rent_invoices ua on ua.journal_entry_id = je.id
    join rental.uae_leases l on l.id = ua.lease_id
  where je.voucher_type = 'uae_rent_invoice'
)
update accounting.journal_entry_lines jel
set cost_center_id = cc.id
from inv
  join accounting.cost_centers cc on cc.asset_id = inv.asset_id
where jel.journal_entry_id = inv.je_id
  and jel.cost_center_id is null;

alter table accounting.journal_entry_lines enable trigger trg_prevent_posted_line_update;
