-- Opening-balance vouchers are corrections to the opening figures: no downstream
-- vouchers reference them, so editing the amounts of a *posted* opening balance
-- is safe. The generic "posted entries are immutable" guards (0004/0015) still
-- apply to every other voucher type. Exempt only journal entries whose
-- voucher_type = 'opening_balance_voucher' so their lines can be rewritten in
-- place while staying posted (the app rebuilds a balanced set every time).

create or replace function accounting.fn_prevent_posted_entry_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Opening balances remain editable after posting.
  if old.voucher_type = 'opening_balance_voucher' then
    return new;
  end if;
  if old.status = 'posted' then
    raise exception 'Journal entry % is posted and cannot be modified', old.id;
  end if;
  return new;
end;
$$;

create or replace function accounting.fn_prevent_posted_line_changes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_type text;
begin
  select status, voucher_type into v_status, v_type
  from accounting.journal_entries
  where id = coalesce(new.journal_entry_id, old.journal_entry_id);

  -- Opening-balance lines stay editable after posting.
  if v_type = 'opening_balance_voucher' then
    return coalesce(new, old);
  end if;

  if v_status = 'posted' then
    raise exception 'Journal entry lines cannot change once the entry is posted';
  end if;
  return coalesce(new, old);
end;
$$;
