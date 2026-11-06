-- The agent's monthly rent statement, as one document.
--
-- The agent sends ONE sheet a month covering every unit: the short-term
-- lettings at 10% management, and the long-term units at 5%. Today that sheet
-- has to be split across two voucher types to get in, and then added back up by
-- hand to see whether it agrees with what the agent says. The whole point of
-- entering it is that the two should agree, so the document goes in as the
-- document: one voucher, one total, both kinds of line.
--
-- Three decisions worth stating, because each of them is a thing that was got
-- wrong before:
--
-- 1. THE SHEET'S OWN FIGURES ARE WHAT IS STORED. The agent rounds — 7,167 at
--    10% is 716.70 on a calculator and 717 on the sheet — so management is an
--    AMOUNT, not a rate the voucher recomputes. A system that insists on its
--    own arithmetic disagrees with the statement by thirty fils and throws away
--    the one thing this document exists to prove.
--
-- 2. A LINE BELONGS TO A MONTH, NOT TO A SPREAD OF DAYS. SSA counts rent by
--    the month the letting starts in: 15 Nov – 15 Dec is November's rent, and
--    a two-month letting is two rent months starting there. So a line carries
--    its first rent month and how many months it covers, and nothing is ever
--    apportioned by day.
--
-- 3. A LONG-TERM LINE INVOICES NOTHING. 501 CRECENT IMPZ is already invoiced
--    monthly from its lease — URI-000034 for August, URI-000035 for September,
--    8,000 less 400 agent share each — and the sheet's 16,000 less 800 is those
--    same two months restated. Raising an invoice from it would bill the year
--    twice. The line is carried so the voucher's total equals the sheet's
--    total, and it is MATCHED to the invoice that already exists.

-- ---------- the statement -----------------------------------------------
create table if not exists rental.rent_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies(id) on delete cascade,
  journal_entry_id uuid not null references accounting.journal_entries(id) on delete cascade,
  voucher_no text,
  -- The date the agent put on the sheet.
  statement_date date not null,
  -- The month the sheet is headed with. The rent months of its lines normally
  -- start here, but a line may say otherwise and the line is what counts.
  statement_month date not null,
  -- Whose statement it is: the agent's account, which every line settles on.
  agent_account_id uuid not null references accounting.chart_of_accounts(id),
  currency_id uuid not null references core.currencies(id),
  exchange_rate numeric not null default 1 check (exchange_rate > 0),
  -- The sheet's own totals, stored as the sheet states them. The lines must add
  -- up to these or the voucher does not save: that check is the document's
  -- whole purpose, so it is kept rather than recomputed and assumed.
  total_rent numeric not null default 0,
  total_management numeric not null default 0,
  total_deductions numeric not null default 0,
  total_net numeric not null default 0,
  narration text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz
);
comment on table rental.rent_statements is
  'One monthly sheet from the letting agent, covering short-term and long-term units together. Its totals are the sheet''s own, so the voucher can prove it agrees with the statement.';

-- ---------- its lines ---------------------------------------------------
create table if not exists rental.rent_statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references rental.rent_statements(id) on delete cascade,
  line_no smallint not null,
  -- 'short_term': billed here, 10% by default, carries utilities.
  -- 'long_term' : already invoiced from its lease; carried for the total only.
  line_type text not null check (line_type in ('short_term', 'long_term')),
  -- The unit, as the rest of SSA knows it.
  cost_center_id uuid references accounting.cost_centers(id),
  -- The letting itself. Both ends, as the sheet gives them.
  period_from date,
  period_to date,
  -- Which month this line's rent is, and how many months it covers. The first
  -- month plus the count IS the schedule: month i gets rent / months.
  rent_month date not null,
  months smallint not null default 1 check (months between 1 and 24),
  rent_amount numeric not null default 0,
  -- As the sheet states it. Never recomputed from a rate (see 1 above).
  management_amount numeric not null default 0,
  dewa numeric not null default 0,
  internet numeric not null default 0,
  access_card numeric not null default 0,
  wifi numeric not null default 0,
  other numeric not null default 0,
  -- rent - management - (dewa + internet + access_card + wifi + other)
  net_amount numeric not null default 0,
  -- A long-term line names the invoice it restates, so the match is a fact on
  -- the row rather than something a reader has to work out.
  matched_invoice_id uuid references rental.uae_rent_invoices(id),
  remarks text,
  created_at timestamptz not null default now()
);
comment on column rental.rent_statement_lines.months is
  'How many rent months this line covers, counted from rent_month. 18 Jul - 17 Sep is 2: the month starting 18 Jul and the one starting 18 Aug.';
comment on column rental.rent_statement_lines.management_amount is
  'The management fee AS THE SHEET STATES IT. The agent rounds; a recomputed figure would disagree with the statement.';

create index if not exists idx_rent_statement_lines_statement on rental.rent_statement_lines (statement_id);
create index if not exists idx_rent_statement_lines_month on rental.rent_statement_lines (rent_month);
create index if not exists idx_rent_statement_lines_unit on rental.rent_statement_lines (cost_center_id);

-- ---------- what the sheet calls each unit -------------------------------
-- The sheet writes "218 X-17 IC"; SSA has a cost centre with its own name and
-- code. Matching them by eye on every import is how a line quietly lands on the
-- wrong unit, so the answer is remembered the first time it is given.
create table if not exists rental.unit_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies(id) on delete cascade,
  alias text not null,
  cost_center_id uuid not null references accounting.cost_centers(id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_unit_aliases_company_alias
  on rental.unit_aliases (company_id, lower(btrim(alias)));
comment on table rental.unit_aliases is
  'What the agent''s sheet calls each unit, so an import maps it without being asked twice.';

-- ---------- row security -------------------------------------------------
alter table rental.rent_statements enable row level security;
alter table rental.rent_statement_lines enable row level security;
alter table rental.unit_aliases enable row level security;

drop policy if exists rent_statements_select on rental.rent_statements;
create policy rent_statements_select on rental.rent_statements for select
  using (company_id = core.current_company_id());
drop policy if exists rent_statements_insert on rental.rent_statements;
create policy rent_statements_insert on rental.rent_statements for insert
  with check (company_id = core.current_company_id() and core.user_has_permission('rent_statement', 'create'));
drop policy if exists rent_statements_update on rental.rent_statements;
create policy rent_statements_update on rental.rent_statements for update
  using (company_id = core.current_company_id() and core.user_has_permission('rent_statement', 'edit'));
drop policy if exists rent_statements_delete on rental.rent_statements;
create policy rent_statements_delete on rental.rent_statements for delete
  using (company_id = core.current_company_id() and core.user_has_permission('rent_statement', 'delete'));

drop policy if exists rent_statement_lines_all on rental.rent_statement_lines;
create policy rent_statement_lines_all on rental.rent_statement_lines for all
  using (exists (select 1 from rental.rent_statements s
                  where s.id = statement_id and s.company_id = core.current_company_id()))
  with check (exists (select 1 from rental.rent_statements s
                       where s.id = statement_id and s.company_id = core.current_company_id()));

drop policy if exists unit_aliases_select on rental.unit_aliases;
create policy unit_aliases_select on rental.unit_aliases for select
  using (company_id = core.current_company_id());
drop policy if exists unit_aliases_write on rental.unit_aliases;
create policy unit_aliases_write on rental.unit_aliases for all
  using (company_id = core.current_company_id() and core.user_has_permission('rent_statement', 'create'))
  with check (company_id = core.current_company_id() and core.user_has_permission('rent_statement', 'create'));

grant select, insert, update, delete on rental.rent_statements to authenticated;
grant select, insert, update, delete on rental.rent_statement_lines to authenticated;
grant select, insert, update, delete on rental.unit_aliases to authenticated;

-- ---------- the voucher type --------------------------------------------
alter table accounting.journal_entries drop constraint if exists journal_entries_voucher_type_check;
alter table accounting.journal_entries add constraint journal_entries_voucher_type_check
  check (voucher_type = any (array[
    'purchase_voucher','receipt_voucher','payment_voucher','pdc_payment_voucher','pdc_receipt_voucher',
    'cheque_return_voucher','journal_voucher','jv_maintenance_voucher','opening_balance_voucher',
    'uae_rent_invoice','pk_rent_invoice','asset_sales','multi_currency_journal','expense_voucher',
    'rent_statement'
  ]));

-- The numbering table keeps its own list of what may be numbered.
alter table core.document_sequences drop constraint if exists document_sequences_voucher_type_check;
alter table core.document_sequences add constraint document_sequences_voucher_type_check
  check (voucher_type = any (array[
    'purchase_voucher','receipt_voucher','payment_voucher','pdc_payment_voucher','pdc_receipt_voucher',
    'cheque_return_voucher','journal_voucher','jv_maintenance_voucher','opening_balance_voucher',
    'uae_rent_invoice','pk_rent_invoice','asset_sales','assets','cost_centers','chart_of_accounts',
    'hh_lease','multi_currency_journal','expense_voucher','rent_statement'
  ]));

insert into core.document_sequences (company_id, voucher_type, prefix, next_number)
select id, 'rent_statement', 'RS', 1 from core.companies
on conflict do nothing;
