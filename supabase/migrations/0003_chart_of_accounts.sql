-- =============================================================================
-- Phase 3: Chart of Accounts & Cost Centers
-- Unlimited-level account tree (adjacency list via parent_id) and one cost
-- center per registered asset. cost_centers.asset_id has no FK yet — Phase 6
-- (Asset Registration) adds `references assets.assets(id)` once that table
-- exists, following the same incremental pattern as company_currencies.
-- =============================================================================

create schema if not exists accounting;

create table accounting.chart_of_accounts (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references core.companies(id) on delete cascade,
  account_code             text not null,
  account_name             text not null,
  parent_id                uuid references accounting.chart_of_accounts(id) on delete restrict,
  account_type             text not null check (account_type in ('asset','liability','income','expense','equity')),
  currency_id              uuid references core.currencies(id) on delete restrict,
  opening_balance          numeric(18,2) not null default 0,
  opening_balance_currency_id uuid references core.currencies(id) on delete restrict,
  is_group                 boolean not null default false,
  is_active                boolean not null default true,
  created_by               uuid not null references auth.users(id),
  created_at               timestamptz not null default now(),
  updated_by               uuid references auth.users(id),
  updated_at               timestamptz,
  deleted_by               uuid references auth.users(id),
  deleted_at               timestamptz,
  constraint chart_of_accounts_code_unique unique (company_id, account_code),
  constraint chart_of_accounts_no_self_parent check (parent_id is distinct from id)
);

create index idx_chart_of_accounts_company on accounting.chart_of_accounts(company_id);
create index idx_chart_of_accounts_parent on accounting.chart_of_accounts(parent_id);

create trigger trg_chart_of_accounts_touch
  before update on accounting.chart_of_accounts
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_chart_of_accounts after insert or update or delete on accounting.chart_of_accounts
  for each row execute function audit.fn_row_audit();

-- A child account must belong to the same company as its parent, share its
-- account_type (an Asset group cannot parent a Liability account), and the
-- parent must actually be a group/header node — leaf accounts don't take
-- children.
create or replace function accounting.fn_validate_account_hierarchy()
returns trigger
language plpgsql
as $$
declare
  v_parent accounting.chart_of_accounts;
begin
  if new.parent_id is not null then
    select * into v_parent from accounting.chart_of_accounts where id = new.parent_id;

    if v_parent is null then
      raise exception 'Parent account % does not exist', new.parent_id;
    end if;
    if v_parent.company_id <> new.company_id then
      raise exception 'Parent account belongs to a different company';
    end if;
    if v_parent.account_type <> new.account_type then
      raise exception 'Child account_type (%) must match parent account_type (%)', new.account_type, v_parent.account_type;
    end if;
    if not v_parent.is_group then
      raise exception 'Parent account % is not a group account and cannot have children', v_parent.account_code;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_validate_account_hierarchy
  before insert or update of parent_id, account_type, company_id on accounting.chart_of_accounts
  for each row execute function accounting.fn_validate_account_hierarchy();

-- On re-parenting (UPDATE only — a brand new row can't yet be its own
-- ancestor), walk up from the proposed new parent and make sure this row
-- isn't among its own ancestors.
create or replace function accounting.fn_check_account_no_cycle()
returns trigger
language plpgsql
as $$
declare
  v_ancestor_id uuid;
begin
  if new.parent_id is null or new.parent_id = old.parent_id then
    return new;
  end if;

  v_ancestor_id := new.parent_id;
  while v_ancestor_id is not null loop
    if v_ancestor_id = new.id then
      raise exception 'Cannot re-parent account: would create a cycle';
    end if;
    select parent_id into v_ancestor_id from accounting.chart_of_accounts where id = v_ancestor_id;
  end loop;

  return new;
end;
$$;

create trigger trg_check_account_no_cycle
  before update of parent_id on accounting.chart_of_accounts
  for each row execute function accounting.fn_check_account_no_cycle();

-- Soft-deleting a group account that still has active children would orphan
-- them from the tree's perspective (deleted_at is filtered out of every
-- SELECT policy); block it instead.
create or replace function accounting.fn_prevent_delete_with_children()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    if exists (
      select 1 from accounting.chart_of_accounts
      where parent_id = new.id and deleted_at is null
    ) then
      raise exception 'Cannot delete account %: it still has active child accounts', new.account_code;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_prevent_delete_with_children
  before update of deleted_at on accounting.chart_of_accounts
  for each row execute function accounting.fn_prevent_delete_with_children();

-- -----------------------------------------------------------------------------
-- Cost centers — one per registered asset (asset_id wired up in Phase 6)
-- -----------------------------------------------------------------------------

create table accounting.cost_centers (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  code             text not null,
  name             text not null,
  asset_id         uuid,
  country          text,
  city             text,
  property_type    text,
  building         text,
  plot_number      text,
  owner            text,
  rental_status    text not null default 'vacant' check (rental_status in ('vacant','occupied','under_maintenance','not_applicable')),
  is_active        boolean not null default true,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz,
  deleted_by       uuid references auth.users(id),
  deleted_at       timestamptz,
  constraint cost_centers_code_unique unique (company_id, code)
);

create index idx_cost_centers_company on accounting.cost_centers(company_id);
create index idx_cost_centers_asset on accounting.cost_centers(asset_id);

create trigger trg_cost_centers_touch
  before update on accounting.cost_centers
  for each row execute function core.fn_touch_updated_at();

create trigger trg_audit_cost_centers after insert or update or delete on accounting.cost_centers
  for each row execute function audit.fn_row_audit();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table accounting.chart_of_accounts enable row level security;
alter table accounting.cost_centers enable row level security;

create policy chart_of_accounts_select on accounting.chart_of_accounts
  for select using (company_id = core.current_company_id() and deleted_at is null);
create policy chart_of_accounts_insert on accounting.chart_of_accounts
  for insert with check (
    company_id = core.current_company_id() and core.user_has_permission('chart_of_accounts', 'create')
  );
create policy chart_of_accounts_update on accounting.chart_of_accounts
  for update using (
    company_id = core.current_company_id() and core.user_has_permission('chart_of_accounts', 'edit')
  );
create policy chart_of_accounts_delete on accounting.chart_of_accounts
  for update using (
    company_id = core.current_company_id() and core.user_has_permission('chart_of_accounts', 'delete')
  );

create policy cost_centers_select on accounting.cost_centers
  for select using (company_id = core.current_company_id() and deleted_at is null);
create policy cost_centers_insert on accounting.cost_centers
  for insert with check (
    company_id = core.current_company_id() and core.user_has_permission('cost_centers', 'create')
  );
create policy cost_centers_update on accounting.cost_centers
  for update using (
    company_id = core.current_company_id() and core.user_has_permission('cost_centers', 'edit')
  );
create policy cost_centers_delete on accounting.cost_centers
  for update using (
    company_id = core.current_company_id() and core.user_has_permission('cost_centers', 'delete')
  );
