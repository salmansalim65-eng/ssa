-- Whoever raised a voucher may edit it until it is posted.
--
-- A data-entry clerk holds view + create. Until now editing needed the Edit
-- permission on the voucher type, which meant a voucher sent back to its author
-- for correction could not be corrected by them — "send back" had no one to send
-- it back to. Granting Edit instead would let the clerk rewrite everyone else's
-- vouchers, which is not the intent.
--
-- So the UPDATE policies gain one more way in: created_by = auth.uid(), while
-- the entry is not posted. Posting is still the line that makes a voucher
-- permanent — a posted voucher only moves through the SECURITY DEFINER
-- functions. Because these policies have no separate WITH CHECK, the same
-- expression is applied to the updated row, so the creator cannot lift their own
-- voucher to 'posted' either.
--
-- The line tables already allow 'create' OR 'edit', so they need no change.

drop policy if exists journal_entries_update on accounting.journal_entries;
create policy journal_entries_update on accounting.journal_entries
  for update using (
    company_id = core.current_company_id()
    and (
      core.user_has_permission(voucher_type, 'edit')
      or core.user_has_permission(voucher_type, 'post')
      or core.user_has_permission(voucher_type, 'approve')
      or core.user_has_permission(voucher_type, 'reject')
      or (created_by = auth.uid() and status <> 'posted')
    )
  );

do $$
declare
  r record;
  v_extra text;
begin
  for r in
    select * from (values
      ('receipt_vouchers', 'receipt_voucher', ''),
      ('payment_vouchers', 'payment_voucher', ''),
      ('journal_vouchers', 'journal_voucher', ''),
      ('jv_maintenance_vouchers', 'jv_maintenance_voucher', ''),
      ('opening_balance_vouchers', 'opening_balance_voucher', ''),
      ('multi_currency_journal_vouchers', 'multi_currency_journal', ''),
      ('pdc_receipt_vouchers', 'pdc_receipt_voucher',
        $x$ or core.user_has_permission('cheque_return_voucher', 'post')$x$),
      ('pdc_payment_vouchers', 'pdc_payment_voucher',
        $x$ or core.user_has_permission('cheque_return_voucher', 'post')$x$)
    ) as t(tbl, vtype, extra)
  loop
    v_extra := r.extra;
    execute format('drop policy if exists %I on accounting.%I', r.tbl || '_update', r.tbl);
    execute format($f$
      create policy %I on accounting.%I
        for update using (
          company_id = core.current_company_id()
          and (
            core.user_has_permission(%L, 'edit')
            or core.user_has_permission(%L, 'post')
            %s
            or (
              created_by = auth.uid()
              and exists (
                select 1 from accounting.journal_entries je
                where je.id = journal_entry_id and je.status <> 'posted'
              )
            )
          )
        )$f$, r.tbl || '_update', r.tbl, r.vtype, r.vtype, v_extra);
  end loop;
end $$;
