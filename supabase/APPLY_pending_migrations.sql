-- Pending fix: run once in Supabase → SQL Editor. Safe to re-run.
-- Replace the v_open_jv_items view with a SECURITY DEFINER function.
--
-- As a security_invoker view, v_open_jv_items depended on the caller's RLS +
-- table grants across journal_vouchers / journal_voucher_lines / journal_entries
-- and could silently return nothing through PostgREST. A SECURITY DEFINER
-- function runs with the owner's privileges (bypassing those per-row RLS
-- policies) while still scoping to the caller's company via
-- core.current_company_id() — the same source that stamps each JV's company_id.
-- This is the app's established pattern for RLS-sensitive reads.

drop view if exists accounting.v_open_jv_items;

create or replace function accounting.fn_open_jv_items(p_side text)
returns table (
  journal_line_id uuid,
  voucher_id uuid,
  voucher_no text,
  entry_date date,
  narration text,
  account_id uuid,
  side text,
  amount numeric,
  remaining numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select
      jvl.id as journal_line_id,
      jv.id as voucher_id,
      jv.voucher_no,
      jv.entry_date,
      jv.narration,
      jvl.debit_account_id as account_id,
      'debit'::text as side,
      jvl.amount
    from accounting.journal_voucher_lines jvl
      join accounting.journal_vouchers jv on jv.id = jvl.voucher_id
      join accounting.journal_entries je on je.id = jv.journal_entry_id
    where je.status = 'posted'::text
      and jv.company_id = core.current_company_id()
    union all
    select
      jvl.id,
      jv.id,
      jv.voucher_no,
      jv.entry_date,
      jv.narration,
      jvl.credit_account_id,
      'credit'::text,
      jvl.amount
    from accounting.journal_voucher_lines jvl
      join accounting.journal_vouchers jv on jv.id = jvl.voucher_id
      join accounting.journal_entries je on je.id = jv.journal_entry_id
    where je.status = 'posted'::text
      and jv.company_id = core.current_company_id()
  )
  select
    l.journal_line_id,
    l.voucher_id,
    l.voucher_no,
    l.entry_date,
    l.narration,
    l.account_id,
    l.side,
    l.amount,
    l.amount - coalesce((
      select sum(s.amount) from accounting.jv_open_item_settlements s
      where s.journal_line_id = l.journal_line_id and s.side = l.side
    ), 0) as remaining
  from lines l
  where l.side = p_side;
$$;

grant execute on function accounting.fn_open_jv_items(text) to authenticated;

-- Reload PostgREST so the new function is exposed to the API immediately.
notify pgrst, 'reload schema';
