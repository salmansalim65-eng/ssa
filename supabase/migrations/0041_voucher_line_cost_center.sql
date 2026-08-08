-- =============================================================================
-- Purchase Voucher and Sale Asset Voucher gain a per-line Cost Centre, shown in
-- the grid before the Fixed Asset account. The cost centre is stored on each
-- voucher line and tagged onto the matching journal-entry line so cost-centre
-- reporting picks up asset purchases and disposals.
-- =============================================================================

alter table accounting.purchase_voucher_lines
  add column if not exists cost_center_id uuid references accounting.cost_centers(id);

alter table assets.asset_sale_lines
  add column if not exists cost_center_id uuid references accounting.cost_centers(id);

select pg_notify('pgrst', 'reload schema');
