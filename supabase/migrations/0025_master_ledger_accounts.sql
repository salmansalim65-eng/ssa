-- =============================================================================
-- Auto-file Assets, Suppliers, and Tenants into the Chart of Accounts.
--
-- Each of the three master records now owns a ledger account, created
-- automatically under a dedicated group so the Chart of Accounts stays
-- separated by type:
--     Assets    -> "ASSETS"    group (asset)
--     Suppliers -> "SUPPLIERS" group (liability)
--     Tenants   -> "TENANTS"   group (asset)
--
-- Mirrors the existing "every asset gets a cost center" pattern
-- (assets.fn_create_cost_center_for_asset): SECURITY DEFINER triggers that
-- create the accounting object as a side effect of the master insert, and
-- keep its name in sync on rename. The group is reused if it already exists
-- (the company has already built ASSETS/SUPPLIERS/TENANTS by hand), else
-- created. Existing records are backfilled at the bottom.
-- =============================================================================

-- Link column: which ledger account represents this master record.
alter table assets.assets
  add column if not exists account_id uuid references accounting.chart_of_accounts(id) on delete set null;
alter table assets.suppliers
  add column if not exists account_id uuid references accounting.chart_of_accounts(id) on delete set null;
alter table rental.tenants
  add column if not exists account_id uuid references accounting.chart_of_accounts(id) on delete set null;

-- --------------------------------------------------------------------------
-- Internal helpers (not exposed to clients — only the definer triggers below
-- call them).
-- --------------------------------------------------------------------------

-- Next Chart-of-Accounts code (AC-000001…), reusing the same document
-- sequence the manual "New account" screen uses. No permission check: this is
-- an internal side effect of creating an already-authorised master record.
create or replace function accounting.fn_next_coa_code(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq core.document_sequences%rowtype;
begin
  insert into core.document_sequences (company_id, voucher_type, prefix, padding)
  values (p_company_id, 'chart_of_accounts', 'AC', 6)
  on conflict (company_id, voucher_type) do nothing;

  select * into v_seq
  from core.document_sequences
  where company_id = p_company_id and voucher_type = 'chart_of_accounts'
  for update;

  update core.document_sequences
  set next_number = next_number + 1
  where id = v_seq.id;

  return v_seq.prefix || '-' || lpad(v_seq.next_number::text, v_seq.padding, '0');
end;
$$;

-- Get-or-create the named group, then create a child ledger account under it
-- for the given record. The child inherits the group's account_type so it
-- always satisfies fn_validate_account_hierarchy.
create or replace function accounting.fn_link_master_account(
  p_company_id uuid,
  p_group_name text,
  p_default_type text,
  p_record_name text,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id   uuid;
  v_group_type text;
  v_account_id uuid;
begin
  select id, account_type into v_group_id, v_group_type
  from accounting.chart_of_accounts
  where company_id = p_company_id
    and is_group = true
    and deleted_at is null
    and upper(account_name) = upper(p_group_name)
  order by account_code
  limit 1;

  if v_group_id is null then
    insert into accounting.chart_of_accounts (company_id, account_code, account_name, account_type, is_group, created_by)
    values (p_company_id, accounting.fn_next_coa_code(p_company_id), upper(p_group_name), p_default_type, true, p_created_by)
    returning id into v_group_id;
    v_group_type := p_default_type;
  end if;

  insert into accounting.chart_of_accounts (company_id, account_code, account_name, parent_id, account_type, is_group, created_by)
  values (p_company_id, accounting.fn_next_coa_code(p_company_id), p_record_name, v_group_id, v_group_type, false, p_created_by)
  returning id into v_account_id;

  return v_account_id;
end;
$$;

revoke execute on function accounting.fn_next_coa_code(uuid) from public, anon, authenticated;
revoke execute on function accounting.fn_link_master_account(uuid, text, text, text, uuid) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Assets
-- --------------------------------------------------------------------------
create or replace function assets.fn_link_asset_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is null then
    new.account_id := accounting.fn_link_master_account(
      new.company_id, 'ASSETS', 'asset', new.asset_name, new.created_by);
  end if;
  return new;
end;
$$;

create trigger trg_link_asset_account
  before insert on assets.assets
  for each row execute function assets.fn_link_asset_account();

create or replace function assets.fn_sync_asset_account_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is not null and new.asset_name is distinct from old.asset_name then
    update accounting.chart_of_accounts
    set account_name = new.asset_name, updated_by = auth.uid(), updated_at = now()
    where id = new.account_id;
  end if;
  return new;
end;
$$;

create trigger trg_sync_asset_account_name
  after update on assets.assets
  for each row execute function assets.fn_sync_asset_account_name();

-- --------------------------------------------------------------------------
-- Suppliers
-- --------------------------------------------------------------------------
create or replace function assets.fn_link_supplier_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is null then
    new.account_id := accounting.fn_link_master_account(
      new.company_id, 'SUPPLIERS', 'liability', new.name, new.created_by);
  end if;
  return new;
end;
$$;

create trigger trg_link_supplier_account
  before insert on assets.suppliers
  for each row execute function assets.fn_link_supplier_account();

create or replace function assets.fn_sync_supplier_account_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is not null and new.name is distinct from old.name then
    update accounting.chart_of_accounts
    set account_name = new.name, updated_by = auth.uid(), updated_at = now()
    where id = new.account_id;
  end if;
  return new;
end;
$$;

create trigger trg_sync_supplier_account_name
  after update on assets.suppliers
  for each row execute function assets.fn_sync_supplier_account_name();

-- --------------------------------------------------------------------------
-- Tenants
-- --------------------------------------------------------------------------
create or replace function rental.fn_link_tenant_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is null then
    new.account_id := accounting.fn_link_master_account(
      new.company_id, 'TENANTS', 'asset', new.name, new.created_by);
  end if;
  return new;
end;
$$;

create trigger trg_link_tenant_account
  before insert on rental.tenants
  for each row execute function rental.fn_link_tenant_account();

create or replace function rental.fn_sync_tenant_account_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is not null and new.name is distinct from old.name then
    update accounting.chart_of_accounts
    set account_name = new.name, updated_by = auth.uid(), updated_at = now()
    where id = new.account_id;
  end if;
  return new;
end;
$$;

create trigger trg_sync_tenant_account_name
  after update on rental.tenants
  for each row execute function rental.fn_sync_tenant_account_name();

-- --------------------------------------------------------------------------
-- Backfill existing records (runs as the migration owner, bypassing RLS).
-- --------------------------------------------------------------------------
do $$
declare r record; v_acct uuid;
begin
  for r in select id, company_id, asset_name, created_by from assets.assets
           where account_id is null and deleted_at is null loop
    v_acct := accounting.fn_link_master_account(r.company_id, 'ASSETS', 'asset', r.asset_name, r.created_by);
    update assets.assets set account_id = v_acct where id = r.id;
  end loop;

  for r in select id, company_id, name, created_by from assets.suppliers
           where account_id is null and deleted_at is null loop
    v_acct := accounting.fn_link_master_account(r.company_id, 'SUPPLIERS', 'liability', r.name, r.created_by);
    update assets.suppliers set account_id = v_acct where id = r.id;
  end loop;

  for r in select id, company_id, name, created_by from rental.tenants
           where account_id is null and deleted_at is null loop
    v_acct := accounting.fn_link_master_account(r.company_id, 'TENANTS', 'asset', r.name, r.created_by);
    update rental.tenants set account_id = v_acct where id = r.id;
  end loop;
end $$;
