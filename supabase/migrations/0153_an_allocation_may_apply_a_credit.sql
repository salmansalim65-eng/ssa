-- An adjustment may apply a credit, not only pay a debt.
--
-- 0151 let a statement line be worth less than nothing: an empty unit whose
-- utilities we paid is a bill the agent sets AGAINST what he owes. Settling
-- October then needs the credit applied as part of the same receipt — the
-- money that arrived is already short by it — and an allocation could only
-- ever be positive.
--
-- Zero is still refused: an adjustment of nothing records nothing.

alter table rental.receipt_invoice_allocations
  drop constraint if exists receipt_invoice_allocations_amount_check;
alter table rental.receipt_invoice_allocations
  add constraint receipt_invoice_allocations_amount_check check (amount <> 0);

comment on column rental.receipt_invoice_allocations.amount is
  'What this receipt line sets against the bill. Negative where the bill is a credit — an empty unit whose costs the agent deducts from what he owes.';
