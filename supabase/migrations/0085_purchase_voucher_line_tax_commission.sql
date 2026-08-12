-- Per-line Tax and Commission on purchase vouchers. Informational amounts
-- captured alongside each asset line's gross value.

alter table accounting.purchase_voucher_lines
  add column if not exists tax numeric(18, 2) not null default 0,
  add column if not exists commission numeric(18, 2) not null default 0;
