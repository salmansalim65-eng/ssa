-- Restrict voucher visibility to the creator: a user sees the vouchers THEY
-- created; not other users'. Admins still see everything, and so does anyone who
-- can approve or post that voucher type (they need to see others' vouchers to
-- act on them). Applies to every accounting voucher header table — the list and
-- the detail both read through these SELECT policies.
do $$
declare
  t text;
  vtype text;
  pairs text[][] := array[
    ['receipt_vouchers','receipt_voucher'],
    ['payment_vouchers','payment_voucher'],
    ['pdc_payment_vouchers','pdc_payment_voucher'],
    ['pdc_receipt_vouchers','pdc_receipt_voucher'],
    ['cheque_return_vouchers','cheque_return_voucher'],
    ['journal_vouchers','journal_voucher'],
    ['jv_maintenance_vouchers','jv_maintenance_voucher'],
    ['opening_balance_vouchers','opening_balance_voucher'],
    ['multi_currency_journal_vouchers','multi_currency_journal']
  ];
  i int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    t := pairs[i][1];
    vtype := pairs[i][2];
    execute format('drop policy if exists %I on accounting.%I', t || '_select', t);
    execute format(
      'create policy %I on accounting.%I for select using (
         company_id = core.current_company_id()
         and (
           created_by = auth.uid()
           or core.is_admin()
           or core.user_has_permission(%L, ''approve'')
           or core.user_has_permission(%L, ''post'')
         )
       )',
      t || '_select', t, vtype, vtype
    );
  end loop;
end $$;
