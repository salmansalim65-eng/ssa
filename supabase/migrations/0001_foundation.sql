-- =============================================================================
-- Phase 1: Foundation
-- Companies, user profiles, roles/permissions, audit trail, document sequences,
-- attachments, system settings, and the RLS/RPC plumbing every later module
-- builds on. See docs/02-database-schema.md for the full conceptual blueprint;
-- this migration implements only the Phase 1 slice of it.
-- =============================================================================

create extension if not exists pgcrypto;

create schema if not exists core;
create schema if not exists audit;

-- -----------------------------------------------------------------------------
-- 0. Generic helpers reused by every migration from here on
-- -----------------------------------------------------------------------------

create or replace function core.fn_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

comment on function core.fn_touch_updated_at() is
  'Generic BEFORE UPDATE trigger: stamps updated_at/updated_by on every business table.';

-- -----------------------------------------------------------------------------
-- 1. Companies
-- -----------------------------------------------------------------------------

create table core.companies (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  name             text not null,
  country          text,
  address          text,
  logo_path        text,
  is_active        boolean not null default true,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz,
  deleted_by       uuid references auth.users(id),
  deleted_at       timestamptz,
  constraint companies_code_unique unique (code)
);

comment on table core.companies is
  'One row per tenant. Base currency is tracked on core.company_currencies.is_base_currency (Phase 2), not on this table.';

create trigger trg_companies_touch
  before update on core.companies
  for each row execute function core.fn_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2. User profiles (1:1 with auth.users) and company membership
-- -----------------------------------------------------------------------------

create table core.user_profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  full_name        text not null,
  -- Snapshot of auth.users.email at signup time, so the app can list users
  -- without querying the auth schema directly. Not kept in sync with email
  -- changes made after signup (out of scope for Phase 1).
  email            text not null,
  phone            text,
  avatar_path      text,
  is_active        boolean not null default true,
  default_company_id uuid references core.companies(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz
);

create trigger trg_user_profiles_touch
  before update on core.user_profiles
  for each row execute function core.fn_touch_updated_at();

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function core.fn_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into core.user_profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), new.email);
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function core.fn_handle_new_auth_user();

create table core.user_companies (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  company_id       uuid not null references core.companies(id) on delete restrict,
  is_default       boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint user_companies_unique unique (user_id, company_id)
);

create index idx_user_companies_user on core.user_companies(user_id);
create index idx_user_companies_company on core.user_companies(company_id);

-- -----------------------------------------------------------------------------
-- 3. Roles & permissions (RBAC)
-- -----------------------------------------------------------------------------

create table core.roles (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete restrict,
  name             text not null,
  description      text,
  is_system_role   boolean not null default false,
  is_active        boolean not null default true,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz,
  deleted_by       uuid references auth.users(id),
  deleted_at       timestamptz,
  constraint roles_company_name_unique unique (company_id, name)
);

create index idx_roles_company on core.roles(company_id);

create trigger trg_roles_touch
  before update on core.roles
  for each row execute function core.fn_touch_updated_at();

-- Static catalog of every screen x action in the system. Company-independent.
create table core.permissions (
  id               uuid primary key default gen_random_uuid(),
  module_key       text not null,
  action           text not null check (action in
    ('view','create','edit','delete','print','export','approve','reject','post')),
  label            text not null,
  constraint permissions_module_action_unique unique (module_key, action)
);

create table core.role_permissions (
  id               uuid primary key default gen_random_uuid(),
  role_id          uuid not null references core.roles(id) on delete cascade,
  permission_id    uuid not null references core.permissions(id) on delete cascade,
  allowed          boolean not null default true,
  constraint role_permissions_unique unique (role_id, permission_id)
);

create index idx_role_permissions_role on core.role_permissions(role_id);

create table core.user_roles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  role_id          uuid not null references core.roles(id) on delete cascade,
  company_id       uuid not null references core.companies(id) on delete cascade,
  created_at       timestamptz not null default now(),
  constraint user_roles_unique unique (user_id, role_id, company_id)
);

create index idx_user_roles_user_company on core.user_roles(user_id, company_id);

-- -----------------------------------------------------------------------------
-- 4. Document sequences (auto-numbering, e.g. PV-000001) and attachments
-- -----------------------------------------------------------------------------

create table core.document_sequences (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  voucher_type     text not null,
  prefix           text not null,
  padding          smallint not null default 6 check (padding between 1 and 12),
  next_number      bigint not null default 1 check (next_number > 0),
  reset_policy     text not null default 'never' check (reset_policy in ('never','yearly','monthly')),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz,
  constraint document_sequences_unique unique (company_id, voucher_type)
);

comment on table core.document_sequences is
  'Numbering configuration per (company, voucher_type). The atomic fn_next_document_number() RPC that consumes this table ships with Phase 4 (Accounting Engine Core), once voucher posting exists.';

create trigger trg_document_sequences_touch
  before update on core.document_sequences
  for each row execute function core.fn_touch_updated_at();

create table core.attachments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  entity_type      text not null,
  entity_id        uuid not null,
  bucket           text not null,
  path             text not null,
  file_name        text not null,
  mime_type        text,
  size_bytes        bigint,
  uploaded_by      uuid not null references auth.users(id),
  uploaded_at      timestamptz not null default now(),
  deleted_by       uuid references auth.users(id),
  deleted_at       timestamptz
);

create index idx_attachments_entity on core.attachments(company_id, entity_type, entity_id);

insert into storage.buckets (id, name, public)
values
  ('asset-images', 'asset-images', false),
  ('title-deeds', 'title-deeds', false),
  ('agreements', 'agreements', false),
  ('receipts', 'receipts', false),
  ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 5. System settings (per-company configuration)
-- -----------------------------------------------------------------------------

create table core.system_settings (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies(id) on delete cascade,
  key              text not null,
  value            jsonb not null default '{}'::jsonb,
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  constraint system_settings_unique unique (company_id, key)
);

-- -----------------------------------------------------------------------------
-- 6. Audit log (generic, trigger-driven)
-- -----------------------------------------------------------------------------

create table audit.audit_logs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid,
  table_name       text not null,
  row_id           uuid not null,
  action           text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data         jsonb,
  new_data         jsonb,
  changed_by       uuid references auth.users(id),
  changed_at       timestamptz not null default now()
);

create index idx_audit_logs_table_row on audit.audit_logs(table_name, row_id);
create index idx_audit_logs_company on audit.audit_logs(company_id);

create or replace function audit.fn_row_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  if tg_op = 'DELETE' then
    v_company_id := (to_jsonb(old) ->> 'company_id')::uuid;
  else
    v_company_id := (to_jsonb(new) ->> 'company_id')::uuid;
  end if;

  insert into audit.audit_logs (company_id, table_name, row_id, action, old_data, new_data, changed_by)
  values (
    v_company_id,
    tg_table_schema || '.' || tg_table_name,
    coalesce((to_jsonb(new) ->> 'id')::uuid, (to_jsonb(old) ->> 'id')::uuid),
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end,
    auth.uid()
  );

  return coalesce(new, old);
end;
$$;

comment on function audit.fn_row_audit() is
  'Generic AFTER INSERT/UPDATE/DELETE trigger. Attach to every business table to capture old/new row state.';

create trigger trg_audit_companies after insert or update or delete on core.companies
  for each row execute function audit.fn_row_audit();
create trigger trg_audit_roles after insert or update or delete on core.roles
  for each row execute function audit.fn_row_audit();
create trigger trg_audit_role_permissions after insert or update or delete on core.role_permissions
  for each row execute function audit.fn_row_audit();
create trigger trg_audit_user_roles after insert or update or delete on core.user_roles
  for each row execute function audit.fn_row_audit();
create trigger trg_audit_document_sequences after insert or update or delete on core.document_sequences
  for each row execute function audit.fn_row_audit();
create trigger trg_audit_system_settings after insert or update or delete on core.system_settings
  for each row execute function audit.fn_row_audit();

-- -----------------------------------------------------------------------------
-- 7. RLS helper functions (current company, permission checks)
-- -----------------------------------------------------------------------------

-- Active company: prefer the JWT claim set by the custom access token hook
-- (core.fn_custom_access_token_hook, registered in Supabase Auth settings);
-- fall back to the user's default company for a token minted before the hook
-- was enabled or before the user picked an active company.
create or replace function core.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'company_id', '')::uuid,
    (select default_company_id from core.user_profiles where id = auth.uid())
  );
$$;

create or replace function core.user_has_permission(p_module_key text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from core.user_roles ur
    join core.role_permissions rp on rp.role_id = ur.role_id and rp.allowed
    join core.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid()
      and ur.company_id = core.current_company_id()
      and p.module_key = p_module_key
      and p.action = p_action
  );
$$;

-- Called from Supabase Auth's Custom Access Token Hook (configure this
-- function under Authentication > Hooks in the Supabase dashboard, or
-- auth.hook.custom_access_token in supabase/config.toml for local dev).
create or replace function core.fn_custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  v_user_id uuid := (event ->> 'user_id')::uuid;
  v_company_id uuid;
begin
  select default_company_id into v_company_id
  from core.user_profiles
  where id = v_user_id;

  claims := coalesce(event -> 'claims', '{}'::jsonb);

  if v_company_id is not null then
    claims := jsonb_set(claims, '{app_metadata,company_id}', to_jsonb(v_company_id::text));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Row Level Security
-- -----------------------------------------------------------------------------

alter table core.companies enable row level security;
alter table core.user_profiles enable row level security;
alter table core.user_companies enable row level security;
alter table core.roles enable row level security;
alter table core.permissions enable row level security;
alter table core.role_permissions enable row level security;
alter table core.user_roles enable row level security;
alter table core.document_sequences enable row level security;
alter table core.attachments enable row level security;
alter table core.system_settings enable row level security;
alter table audit.audit_logs enable row level security;

-- companies: a user may see companies they belong to; only users with
-- companies.edit/create can mutate.
create policy companies_select on core.companies
  for select using (
    id in (select company_id from core.user_companies where user_id = auth.uid())
  );
-- No INSERT policy: RLS default-denies direct inserts from any client role.
-- core.fn_bootstrap_company() is SECURITY DEFINER and bypasses RLS, so it
-- remains the only way to create a company.
create policy companies_update on core.companies
  for update using (
    id = core.current_company_id() and core.user_has_permission('companies', 'edit')
  );

-- user_profiles: everyone can read their own profile; company admins with
-- users.view can read profiles of users in their company.
create policy user_profiles_select_self on core.user_profiles
  for select using (id = auth.uid());
create policy user_profiles_select_company on core.user_profiles
  for select using (
    core.user_has_permission('users', 'view')
    and id in (select user_id from core.user_companies where company_id = core.current_company_id())
  );
create policy user_profiles_update_self on core.user_profiles
  for update using (id = auth.uid());
create policy user_profiles_update_admin on core.user_profiles
  for update using (
    core.user_has_permission('users', 'edit')
    and id in (select user_id from core.user_companies where company_id = core.current_company_id())
  );

-- user_companies
create policy user_companies_select on core.user_companies
  for select using (
    user_id = auth.uid() or company_id = core.current_company_id()
  );
create policy user_companies_insert on core.user_companies
  for insert with check (
    core.user_has_permission('users', 'create') and company_id = core.current_company_id()
  );

-- roles / permissions / role_permissions / user_roles: scoped to active company
create policy roles_select on core.roles
  for select using (company_id = core.current_company_id() and deleted_at is null);
create policy roles_insert on core.roles
  for insert with check (
    company_id = core.current_company_id() and core.user_has_permission('roles', 'create')
  );
create policy roles_update on core.roles
  for update using (
    company_id = core.current_company_id() and core.user_has_permission('roles', 'edit')
  );
create policy roles_delete on core.roles
  for update using (
    company_id = core.current_company_id() and core.user_has_permission('roles', 'delete')
  );

create policy permissions_select on core.permissions
  for select using (auth.uid() is not null);

create policy role_permissions_select on core.role_permissions
  for select using (
    role_id in (select id from core.roles where company_id = core.current_company_id())
  );
create policy role_permissions_write on core.role_permissions
  for all using (
    core.user_has_permission('roles', 'edit')
    and role_id in (select id from core.roles where company_id = core.current_company_id())
  ) with check (
    core.user_has_permission('roles', 'edit')
    and role_id in (select id from core.roles where company_id = core.current_company_id())
  );

create policy user_roles_select on core.user_roles
  for select using (company_id = core.current_company_id());
create policy user_roles_write on core.user_roles
  for all using (
    company_id = core.current_company_id() and core.user_has_permission('users', 'edit')
  ) with check (
    company_id = core.current_company_id() and core.user_has_permission('users', 'edit')
  );

-- document_sequences
create policy document_sequences_select on core.document_sequences
  for select using (company_id = core.current_company_id());
create policy document_sequences_write on core.document_sequences
  for all using (
    company_id = core.current_company_id() and core.user_has_permission('document_sequences', 'edit')
  ) with check (
    company_id = core.current_company_id() and core.user_has_permission('document_sequences', 'edit')
  );

-- attachments
create policy attachments_select on core.attachments
  for select using (company_id = core.current_company_id() and deleted_at is null);
create policy attachments_insert on core.attachments
  for insert with check (company_id = core.current_company_id());
create policy attachments_delete on core.attachments
  for update using (company_id = core.current_company_id());

-- system_settings
create policy system_settings_select on core.system_settings
  for select using (company_id = core.current_company_id());
create policy system_settings_write on core.system_settings
  for all using (
    company_id = core.current_company_id() and core.user_has_permission('system_settings', 'edit')
  ) with check (
    company_id = core.current_company_id() and core.user_has_permission('system_settings', 'edit')
  );

-- audit_logs: read-only, scoped to active company, requires an explicit
-- audit-viewing permission so it isn't casually browsable.
create policy audit_logs_select on audit.audit_logs
  for select using (
    company_id = core.current_company_id() and core.user_has_permission('audit_log', 'view')
  );

-- Storage: files are stored under `<company_id>/...`; only members of that
-- company may read/write, restricted to the buckets seeded above.
create policy storage_company_scoped_select on storage.objects
  for select using (
    bucket_id in ('asset-images','title-deeds','agreements','receipts','attachments')
    and (storage.foldername(name))[1] = core.current_company_id()::text
  );
create policy storage_company_scoped_insert on storage.objects
  for insert with check (
    bucket_id in ('asset-images','title-deeds','agreements','receipts','attachments')
    and (storage.foldername(name))[1] = core.current_company_id()::text
  );
create policy storage_company_scoped_delete on storage.objects
  for delete using (
    bucket_id in ('asset-images','title-deeds','agreements','receipts','attachments')
    and (storage.foldername(name))[1] = core.current_company_id()::text
  );

-- -----------------------------------------------------------------------------
-- 9. Permission catalog seed
-- -----------------------------------------------------------------------------

insert into core.permissions (module_key, action, label)
select m.module_key, a.action, initcap(a.action) || ' ' || replace(m.module_key, '_', ' ')
from (values
  ('companies'), ('users'), ('roles'), ('document_sequences'), ('system_settings'), ('audit_log'),
  ('currencies'), ('exchange_rates'),
  ('chart_of_accounts'), ('cost_centers'),
  ('purchase_voucher'), ('receipt_voucher'), ('payment_voucher'),
  ('pdc_payment_voucher'), ('pdc_receipt_voucher'), ('cheque_return_voucher'),
  ('journal_voucher'), ('jv_maintenance_voucher'), ('opening_balance_voucher'),
  ('approval_workflows'),
  ('assets'), ('asset_valuations'), ('asset_sales'),
  ('uae_rent_invoice'), ('pk_rent_invoice'),
  ('reports'), ('dashboard')
) as m(module_key)
cross join (values
  ('view'), ('create'), ('edit'), ('delete'), ('print'), ('export'), ('approve'), ('reject'), ('post')
) as a(action)
on conflict (module_key, action) do nothing;

-- -----------------------------------------------------------------------------
-- 10. Bootstrap RPC: first company + Administrator role for a new signup
-- -----------------------------------------------------------------------------

create or replace function core.fn_bootstrap_company(
  p_company_name text,
  p_company_code text,
  p_country text
)
returns core.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company core.companies;
  v_role_id uuid;
  v_role_name text;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated to bootstrap a company';
  end if;

  insert into core.companies (code, name, country, created_by)
  values (p_company_code, p_company_name, p_country, auth.uid())
  returning * into v_company;

  foreach v_role_name in array array['Administrator','Accountant','Property Manager','Supervisor','Finance Manager']
  loop
    insert into core.roles (company_id, name, is_system_role, created_by)
    values (v_company.id, v_role_name, v_role_name = 'Administrator', auth.uid())
    returning id into v_role_id;

    if v_role_name = 'Administrator' then
      insert into core.role_permissions (role_id, permission_id, allowed)
      select v_role_id, id, true from core.permissions;
    end if;
  end loop;

  insert into core.user_companies (user_id, company_id, is_default)
  values (auth.uid(), v_company.id, true);

  update core.user_profiles set default_company_id = v_company.id where id = auth.uid();

  insert into core.user_roles (user_id, role_id, company_id)
  select auth.uid(), id, v_company.id from core.roles
  where company_id = v_company.id and name = 'Administrator';

  return v_company;
end;
$$;

comment on function core.fn_bootstrap_company(text, text, text) is
  'Creates a new company, seeds its default roles, grants the calling user the Administrator role, and makes it their default company. This is the only sanctioned way to insert into core.companies.';
