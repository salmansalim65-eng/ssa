-- Both legs of an opening balance carry the account's cost centre.
--
-- An opening balance entered from the Chart of Accounts posts two lines: the
-- account itself, and Opening Balance Equity as its counter. Neither carried a
-- cost centre. The account side is still picked up by the reports, because they
-- fall back to the cost centre an account names as its default (0123) — but the
-- counter side cannot be: Opening Balance Equity is shared by every account, so
-- it has no default of its own.
--
-- A cost-centre-filtered Balance Sheet therefore showed the assets and not their
-- counter-entry, and refused to balance: "Assets (SR 3,357,878 Dr) do not equal
-- liabilities + equity ()".
--
-- The posting code now puts the account's cost centre on BOTH legs. This
-- back-fills the entries already posted, taking each entry's cost centre from
-- whichever of its lines sits on an account that names one. Only
-- cost_center_id is written — no amount, date, account or status changes — so
-- every balance stays exactly as it is; this is attribution, not a correction.
--
-- The posted-line guard is lifted for the statement and put straight back. The
-- audit trigger stays on, so the change is recorded like any other.

alter table accounting.journal_entry_lines disable trigger trg_prevent_posted_line_update;

with entry_cost_centre as (
  select distinct on (l.journal_entry_id)
         l.journal_entry_id,
         a.default_cost_center_id as cost_center_id
  from accounting.journal_entry_lines l
  join accounting.journal_entries je on je.id = l.journal_entry_id
  join accounting.chart_of_accounts a on a.id = l.account_id
  where je.voucher_type = 'opening_balance_voucher'
    and je.status = 'posted'
    and a.default_cost_center_id is not null
  order by l.journal_entry_id, l.line_no
)
update accounting.journal_entry_lines l
set cost_center_id = e.cost_center_id
from entry_cost_centre e
where l.journal_entry_id = e.journal_entry_id
  and l.cost_center_id is null;

alter table accounting.journal_entry_lines enable trigger trg_prevent_posted_line_update;

-- The voucher header follows its lines.
update accounting.opening_balance_vouchers v
set cost_center_id = l.cost_center_id
from accounting.journal_entry_lines l
where l.journal_entry_id = v.journal_entry_id
  and l.cost_center_id is not null
  and v.cost_center_id is null;
