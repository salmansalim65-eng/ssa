-- Re-spread receipt RCT-000021 now that the combined voucher's real net is known.
--
-- The receipt was adjusted while URI-000095 was reported as 32,549.40 net, a
-- figure 5,721 too high because only one of its seven properties' expenses was
-- counted (see 0134). Auto-FIFO filled that inflated bill first, so 5,721 of the
-- money went where there was nothing left to pay and URI-000035 — August rent on
-- 501 CRECENT IMPZ — was left 5,720.40 short.
--
-- The receipt itself is right: 42,029 was received and no accounting entry
-- changes. Only its split across the bills does:
--   URI-000095  26,828.40   (the seven HH properties)
--   URI-000034   7,600.00   (501 CRECENT IMPZ, August)
--   URI-000035   7,600.00   (501 CRECENT IMPZ, September rent, billed in advance)
--   URI-000087       0.60   (106 AYYAN, what is left of the receipt)
--               ---------
--               42,029.00
--
-- One-off and safe elsewhere: it does nothing where this receipt does not exist,
-- and refuses to finish unless the allocations still add up to the receipt.

do $$
declare
  v_receipt uuid;
  v_line    uuid;
  v_company uuid;
  v_total   numeric;
  v_new     numeric;
  v_87      uuid;
begin
  select rv.id, rv.company_id, rv.total_amount into v_receipt, v_company, v_total
  from accounting.receipt_vouchers rv where rv.voucher_no = 'RCT-000021';
  if v_receipt is null then
    raise notice 'RCT-000021 not found - nothing to do';
    return;
  end if;

  select ra.receipt_line_id into v_line
  from rental.receipt_invoice_allocations ra where ra.receipt_voucher_id = v_receipt limit 1;

  update rental.receipt_invoice_allocations ra
  set amount = 26828.40
  from rental.uae_rent_invoices uri
  where uri.id = ra.uae_invoice_id and ra.receipt_voucher_id = v_receipt and uri.voucher_no = 'URI-000095';

  update rental.receipt_invoice_allocations ra
  set amount = 7600.00
  from rental.uae_rent_invoices uri
  where uri.id = ra.uae_invoice_id and ra.receipt_voucher_id = v_receipt and uri.voucher_no = 'URI-000035';

  -- Whatever the receipt still has left goes to the next bill in date order.
  select coalesce(sum(amount), 0) into v_new
  from rental.receipt_invoice_allocations where receipt_voucher_id = v_receipt;
  select id into v_87 from rental.uae_rent_invoices where voucher_no = 'URI-000087';

  if v_87 is not null and v_total - v_new > 0.005 then
    insert into rental.receipt_invoice_allocations
      (company_id, receipt_voucher_id, receipt_line_id, country, uae_invoice_id, pk_invoice_id, amount)
    values
      (v_company, v_receipt, v_line, 'UAE', v_87, null, round(v_total - v_new, 2));
  end if;

  select coalesce(sum(amount), 0) into v_new
  from rental.receipt_invoice_allocations where receipt_voucher_id = v_receipt;
  if abs(v_new - v_total) > 0.005 then
    raise exception 'Allocations % do not add up to the receipt %', v_new, v_total;
  end if;
end $$;
