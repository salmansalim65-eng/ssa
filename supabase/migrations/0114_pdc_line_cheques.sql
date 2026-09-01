-- Move the cheque details of a PDC voucher from its header onto its lines.
--
-- A PDC receipt/payment carried ONE cheque no + cheque date + due date in the
-- header, so a voucher covering several cheques had to be split into several
-- vouchers. The cheque now belongs to the line, and the header gains its own
-- voucher_date — until now the header had no date of its own and the journal
-- entry was dated by the cheque, which no longer makes sense once the cheques
-- differ per line.
--
-- The header cheque_no / cheque_date / due_date columns stay and are written
-- from the FIRST line, so the voucher lists, the Cheque Return picker and the
-- reports that read them keep working unchanged.

-- 1. Header: its own voucher date, backfilled from the cheque it was dated by.
alter table accounting.pdc_receipt_vouchers add column if not exists voucher_date date;
alter table accounting.pdc_payment_vouchers add column if not exists voucher_date date;

update accounting.pdc_receipt_vouchers set voucher_date = cheque_date where voucher_date is null;
update accounting.pdc_payment_vouchers set voucher_date = cheque_date where voucher_date is null;

alter table accounting.pdc_receipt_vouchers alter column voucher_date set not null;
alter table accounting.pdc_payment_vouchers alter column voucher_date set not null;

-- 2. Lines: the cheque itself, backfilled from the header's single cheque.
alter table accounting.pdc_receipt_voucher_lines
  add column if not exists cheque_no text,
  add column if not exists cheque_date date,
  add column if not exists due_date date;

alter table accounting.pdc_payment_voucher_lines
  add column if not exists cheque_no text,
  add column if not exists cheque_date date,
  add column if not exists due_date date;

update accounting.pdc_receipt_voucher_lines l
set cheque_no = v.cheque_no, cheque_date = v.cheque_date, due_date = v.due_date
from accounting.pdc_receipt_vouchers v
where v.id = l.voucher_id and l.cheque_no is null;

update accounting.pdc_payment_voucher_lines l
set cheque_no = v.cheque_no, cheque_date = v.cheque_date, due_date = v.due_date
from accounting.pdc_payment_vouchers v
where v.id = l.voucher_id and l.cheque_no is null;

alter table accounting.pdc_receipt_voucher_lines
  alter column cheque_no set not null,
  alter column cheque_date set not null;

alter table accounting.pdc_payment_voucher_lines
  alter column cheque_no set not null,
  alter column cheque_date set not null;
