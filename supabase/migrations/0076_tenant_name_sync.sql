-- The tenant master is a Chart-of-Accounts leaf (under an is_tenant_group group).
-- rental.tenants only mirrors the account name, copied once when the mirror row
-- is created and never re-synced — so renaming the COA account (e.g. "faraz" ->
-- "SPOT ON (NADEEM)") left the lease list/detail/invoice pages showing the stale
-- mirror name. Backfill the mirror to the authoritative account name, and keep
-- it in sync whenever the account is renamed.
update rental.tenants t
set name = coa.account_name
from accounting.chart_of_accounts coa
where coa.id = t.account_id
  and t.name is distinct from coa.account_name;

create or replace function rental.fn_sync_tenant_name_from_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_name is distinct from old.account_name then
    update rental.tenants set name = new.account_name where account_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_tenant_name on accounting.chart_of_accounts;
create trigger trg_sync_tenant_name
  after update of account_name on accounting.chart_of_accounts
  for each row execute function rental.fn_sync_tenant_name_from_account();
