-- An Expense Voucher, and the Tag master it files expenses under.
--
-- Expenses were only recordable as a Payment Voucher or a Journal, neither of
-- which is shaped like the thing being recorded: a run of small costs paid out
-- of ONE cash or bank account. This voucher is that shape — many expense lines,
-- one account they were paid from.
--
-- The cost centre and the tag sit on each LINE, not the header. One trip to the
-- bank pays for several things at once — a plumber for one property, fuel for
-- another — and a single header cost centre would lose which was which.

create table if not exists core.tags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz,
  deleted_by uuid,
  deleted_at timestamptz
);
comment on table core.tags is
  'Free labels an expense line can be filed under (Maintenance, Travel, Utilities...), so spend groups across accounts and cost centres.';

create unique index if not exists idx_tags_company_name
  on core.tags (company_id, lower(name)) where deleted_at is null;

alter table core.tags enable row level security;

drop policy if exists tags_select on core.tags;
create policy tags_select on core.tags for select
  using (company_id = core.current_company_id() and deleted_at is null);
drop policy if exists tags_insert on core.tags;
create policy tags_insert on core.tags for insert
  with check (company_id = core.current_company_id() and core.user_has_permission('tags', 'create'));
drop policy if exists tags_update on core.tags;
create policy tags_update on core.tags for update
  using (company_id = core.current_company_id() and core.user_has_permission('tags', 'edit'));

grant select, insert, update on core.tags to authenticated;

create table if not exists accounting.expense_vouchers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies(id) on delete cascade,
  journal_entry_id uuid not null references accounting.journal_entries(id) on delete cascade,
  voucher_no text,
  expense_date date not null,
  credit_account_id uuid not null references accounting.chart_of_accounts(id),
  currency_id uuid not null references core.currencies(id),
  exchange_rate numeric not null default 1 check (exchange_rate > 0),
  total_amount numeric not null default 0,
  paid_to text,
  narration text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz
);
comment on column accounting.expense_vouchers.credit_account_id is
  'The cash or bank account the money left. One per voucher: a single payment covering a run of costs is exactly what this document is.';

create table if not exists accounting.expense_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references accounting.expense_vouchers(id) on delete cascade,
  line_no smallint not null,
  account_id uuid not null references accounting.chart_of_accounts(id),
  cost_center_id uuid references accounting.cost_centers(id),
  tag_id uuid references core.tags(id),
  amount numeric not null check (amount > 0),
  remarks text,
  created_at timestamptz not null default now()
);
create index if not exists idx_expense_voucher_lines_voucher on accounting.expense_voucher_lines (voucher_id);
create index if not exists idx_expense_voucher_lines_tag on accounting.expense_voucher_lines (tag_id);

alter table accounting.expense_vouchers enable row level security;
alter table accounting.expense_voucher_lines enable row level security;

drop policy if exists expense_vouchers_select on accounting.expense_vouchers;
create policy expense_vouchers_select on accounting.expense_vouchers for select
  using (company_id = core.current_company_id());
drop policy if exists expense_vouchers_insert on accounting.expense_vouchers;
create policy expense_vouchers_insert on accounting.expense_vouchers for insert
  with check (company_id = core.current_company_id() and core.user_has_permission('expense_voucher', 'create'));
drop policy if exists expense_vouchers_update on accounting.expense_vouchers;
create policy expense_vouchers_update on accounting.expense_vouchers for update
  using (company_id = core.current_company_id() and core.user_has_permission('expense_voucher', 'edit'));
drop policy if exists expense_vouchers_delete on accounting.expense_vouchers;
create policy expense_vouchers_delete on accounting.expense_vouchers for delete
  using (company_id = core.current_company_id() and core.user_has_permission('expense_voucher', 'delete'));

drop policy if exists expense_voucher_lines_select on accounting.expense_voucher_lines;
create policy expense_voucher_lines_select on accounting.expense_voucher_lines for select
  using (exists (select 1 from accounting.expense_vouchers v
                 where v.id = voucher_id and v.company_id = core.current_company_id()));
drop policy if exists expense_voucher_lines_insert on accounting.expense_voucher_lines;
create policy expense_voucher_lines_insert on accounting.expense_voucher_lines for insert
  with check (exists (select 1 from accounting.expense_vouchers v
                      where v.id = voucher_id and v.company_id = core.current_company_id()));
drop policy if exists expense_voucher_lines_update on accounting.expense_voucher_lines;
create policy expense_voucher_lines_update on accounting.expense_voucher_lines for update
  using (exists (select 1 from accounting.expense_vouchers v
                 where v.id = voucher_id and v.company_id = core.current_company_id()));
drop policy if exists expense_voucher_lines_delete on accounting.expense_voucher_lines;
create policy expense_voucher_lines_delete on accounting.expense_voucher_lines for delete
  using (exists (select 1 from accounting.expense_vouchers v
                 where v.id = voucher_id and v.company_id = core.current_company_id()));

grant select, insert, update, delete on accounting.expense_vouchers to authenticated;
grant select, insert, update, delete on accounting.expense_voucher_lines to authenticated;

-- The engine and the numbering both work off a fixed list of voucher types.
alter table accounting.journal_entries drop constraint if exists journal_entries_voucher_type_check;
alter table accounting.journal_entries add constraint journal_entries_voucher_type_check
  check (voucher_type = any (array[
    'purchase_voucher','receipt_voucher','payment_voucher','pdc_payment_voucher','pdc_receipt_voucher',
    'cheque_return_voucher','journal_voucher','jv_maintenance_voucher','opening_balance_voucher',
    'uae_rent_invoice','pk_rent_invoice','asset_sales','multi_currency_journal','expense_voucher'
  ]));

alter table core.document_sequences drop constraint if exists document_sequences_voucher_type_check;
alter table core.document_sequences add constraint document_sequences_voucher_type_check
  check (voucher_type = any (array[
    'purchase_voucher','receipt_voucher','payment_voucher','pdc_payment_voucher','pdc_receipt_voucher',
    'cheque_return_voucher','journal_voucher','jv_maintenance_voucher','opening_balance_voucher',
    'uae_rent_invoice','pk_rent_invoice','asset_sales','assets','cost_centers','chart_of_accounts',
    'hh_lease','multi_currency_journal','expense_voucher'
  ]));

insert into core.permissions (module_key, action, label)
select m.key, a.action, m.label || ' — ' || a.action
from (values ('expense_voucher', 'Expense Voucher'), ('tags', 'Tags')) as m(key, label)
cross join (values ('view'),('create'),('edit'),('delete'),('approve'),('reject'),('post'),('print'),('export')) as a(action)
where not exists (
  select 1 from core.permissions p where p.module_key = m.key and p.action = a.action
);

-- Whoever can raise a payment voucher can raise an expense one, and whoever can
-- keep cost centres can keep tags — so nobody is locked out of a new screen.
insert into core.role_permissions (role_id, permission_id, allowed)
select rp.role_id, np.id, rp.allowed
from core.role_permissions rp
  join core.permissions op on op.id = rp.permission_id
  join core.permissions np
    on np.action = op.action
   and np.module_key = case op.module_key when 'payment_voucher' then 'expense_voucher' else 'tags' end
where op.module_key in ('payment_voucher', 'cost_centers')
  and not exists (select 1 from core.role_permissions x where x.role_id = rp.role_id and x.permission_id = np.id);

insert into core.document_sequences (company_id, voucher_type, prefix, padding, next_number)
select c.id, 'expense_voucher', 'EXP', 6, 1
from core.companies c
where not exists (
  select 1 from core.document_sequences s where s.company_id = c.id and s.voucher_type = 'expense_voucher'
);
