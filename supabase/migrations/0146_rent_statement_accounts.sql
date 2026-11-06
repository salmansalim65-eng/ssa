-- The accounts a rent statement posts to, and the roles that point at them.
--
-- Most of what the sheet deducts was already in the chart, under Rental
-- Expenses Dxb: WIFI, DEWA, ACESS CARD and OTHER EXP. Only two were missing —
-- the sheet's Internet column, and somewhere to hold rent for a month that has
-- not arrived yet.
--
-- Codes are drawn from the same sequence the Chart of Accounts screen draws
-- from, and the sequence is advanced here, so an account made by this
-- migration is indistinguishable from one made on the screen. The screen's
-- own helper is not used because it asks who is signed in, and in a migration
-- nobody is.

-- ---------- 1. Internet, beside the other utilities ------------------------
insert into accounting.chart_of_accounts
  (company_id, account_code, account_name, account_type, is_group, parent_id, created_by)
select c.id,
       'AC-' || lpad((select next_number from core.document_sequences
                        where company_id = c.id and voucher_type = 'chart_of_accounts')::text, 6, '0'),
       'INTERNET',
       'expense',
       false,
       (select id from accounting.chart_of_accounts
         where company_id = c.id and account_code = 'AC-000075' and deleted_at is null),
       (select created_by from accounting.chart_of_accounts
         where company_id = c.id and account_code = 'AC-000075')
  from core.companies c
 where not exists (
   select 1 from accounting.chart_of_accounts a
    where a.company_id = c.id and upper(btrim(a.account_name)) = 'INTERNET' and a.deleted_at is null
 );

update core.document_sequences set next_number = next_number + 1
 where voucher_type = 'chart_of_accounts'
   and exists (select 1 from accounting.chart_of_accounts a
                where a.company_id = document_sequences.company_id
                  and upper(btrim(a.account_name)) = 'INTERNET' and a.deleted_at is null);

-- ---------- 2. Rent billed for a month not yet reached ---------------------
-- A liability: the agent has been billed and will pay, but the month has not
-- happened, so it is not income yet. It empties itself month by month as each
-- one comes round.
insert into accounting.chart_of_accounts
  (company_id, account_code, account_name, account_type, is_group, parent_id, created_by)
select c.id,
       'AC-' || lpad((select next_number from core.document_sequences
                        where company_id = c.id and voucher_type = 'chart_of_accounts')::text, 6, '0'),
       'UNEARNED RENT INCOME',
       'liability',
       false,
       (select id from accounting.chart_of_accounts
         where company_id = c.id and account_code = 'AC-000037' and deleted_at is null),
       (select created_by from accounting.chart_of_accounts
         where company_id = c.id and account_code = 'AC-000037')
  from core.companies c
 where not exists (
   select 1 from accounting.chart_of_accounts a
    where a.company_id = c.id and upper(btrim(a.account_name)) = 'UNEARNED RENT INCOME' and a.deleted_at is null
 );

update core.document_sequences set next_number = next_number + 1
 where voucher_type = 'chart_of_accounts'
   and exists (select 1 from accounting.chart_of_accounts a
                where a.company_id = document_sequences.company_id
                  and upper(btrim(a.account_name)) = 'UNEARNED RENT INCOME' and a.deleted_at is null);

-- ---------- 3. The new voucher type may have posting accounts --------------
alter table accounting.posting_templates drop constraint if exists posting_templates_voucher_type_check;
alter table accounting.posting_templates add constraint posting_templates_voucher_type_check
  check (voucher_type = any (array[
    'purchase_voucher','receipt_voucher','payment_voucher','pdc_payment_voucher','pdc_receipt_voucher',
    'cheque_return_voucher','journal_voucher','jv_maintenance_voucher','opening_balance_voucher',
    'uae_rent_invoice','pk_rent_invoice','asset_sales','rent_statement'
  ]));

-- ---------- 4. Which account each column of the sheet lands on -------------
insert into accounting.posting_templates (company_id, voucher_type, account_role, debit_or_credit, account_id, created_by)
select c.id, 'rent_statement', r.role, r.side,
       (select a.id from accounting.chart_of_accounts a
         where a.company_id = c.id and upper(btrim(a.account_name)) = r.account_name and a.deleted_at is null
         limit 1),
       (select created_by from accounting.chart_of_accounts
         where company_id = c.id and account_code = 'AC-000075')
  from core.companies c
  cross join (values
    ('uae_rental_income',    'credit', 'RENT INCOME DXB'),
    ('unearned_rent_income', 'credit', 'UNEARNED RENT INCOME'),
    ('dewa',                 'debit',  'DEWA'),
    ('internet',             'debit',  'INTERNET'),
    ('access_card',          'debit',  'ACESS CARD'),
    ('wifi',                 'debit',  'WIFI'),
    ('other_rental_expense', 'debit',  'OTHER EXP')
  ) as r(role, side, account_name)
 where exists (
   select 1 from accounting.chart_of_accounts a
    where a.company_id = c.id and upper(btrim(a.account_name)) = r.account_name and a.deleted_at is null
 )
on conflict (company_id, voucher_type, account_role) do nothing;
