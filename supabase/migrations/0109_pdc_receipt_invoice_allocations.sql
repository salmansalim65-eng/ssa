-- Let a PDC Receipt line be applied to a rental invoice, exactly like a normal
-- Receipt voucher. Reuses rental.receipt_invoice_allocations (and its trigger
-- that moves the invoice's outstanding balance) by making the source voucher
-- either a receipt OR a PDC receipt.
alter table rental.receipt_invoice_allocations
  alter column receipt_voucher_id drop not null;

alter table rental.receipt_invoice_allocations
  add column if not exists pdc_receipt_voucher_id uuid
    references accounting.pdc_receipt_vouchers(id) on delete cascade,
  add column if not exists pdc_receipt_line_id uuid
    references accounting.pdc_receipt_voucher_lines(id) on delete cascade;

-- Exactly one source voucher (a receipt or a PDC receipt) owns each allocation.
alter table rental.receipt_invoice_allocations
  drop constraint if exists receipt_alloc_one_source;
alter table rental.receipt_invoice_allocations
  add constraint receipt_alloc_one_source
  check (num_nonnulls(receipt_voucher_id, pdc_receipt_voucher_id) = 1);

create index if not exists idx_receipt_alloc_pdc
  on rental.receipt_invoice_allocations(pdc_receipt_voucher_id);
