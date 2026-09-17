-- A bank account is more than a ledger line.
--
-- Cash & Bank accounts live in the chart of accounts like any other account, so
-- all the app ever held was a name and a balance. The things actually needed to
-- USE the account — which bank, whose name it is in, the account number, the
-- IBAN, the branch — lived in somebody's phone, and were typed out from memory
-- every time a payment had to be made.
--
-- Columns on chart_of_accounts rather than a table of their own: they belong to
-- exactly one account, are read wherever the account is read, and a join for six
-- nullable text fields buys nothing. They stay null for every account that is
-- not a bank, which is most of them.

alter table accounting.chart_of_accounts
  add column if not exists bank_name text,
  add column if not exists bank_account_title text,
  add column if not exists bank_account_no text,
  add column if not exists bank_iban text,
  add column if not exists bank_branch text,
  add column if not exists bank_swift text;

comment on column accounting.chart_of_accounts.bank_account_title is
  'The name the account is held in, which is not always the ledger account''s own name.';
comment on column accounting.chart_of_accounts.bank_account_no is
  'The bank''s account number. Named bank_account_no so it is never mistaken for account_code, the chart''s own numbering.';

select pg_notify('pgrst', 'reload schema');
