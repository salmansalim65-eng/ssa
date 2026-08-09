-- Granular per-user permissions layered over the existing role model.
--
-- Model: every authorization check still funnels through
-- core.user_has_permission / core.user_permitted_actions, so extending those two
-- functions (plus this one table) makes all ~140 RLS policies honour per-user
-- grants with no policy changes.
--
-- Resolution precedence for a (module, action):
--   1. Administrators (system role) always pass — admin is full by default.
--   2. If the user has ANY user_permissions row in the active company, that
--      matrix is authoritative: allowed only where an explicit row says so.
--   3. Otherwise fall back to the role-derived grant (unchanged legacy
--      behaviour, so existing users are unaffected).

create table if not exists core.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references core.companies(id) on delete cascade,
  module_key text not null,
  action text not null check (action in ('view','create','edit','delete','print','export','approve','reject','post')),
  allowed boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz,
  unique (user_id, company_id, module_key, action)
);

alter table core.user_permissions enable row level security;

-- Readable by anyone who can view users in the company; writable by anyone who
-- can edit users. Admins satisfy both via user_has_permission's is_admin bypass.
create policy user_permissions_select on core.user_permissions
  for select using (
    company_id = core.current_company_id() and core.user_has_permission('users', 'view')
  );

create policy user_permissions_write on core.user_permissions
  for all using (
    company_id = core.current_company_id() and core.user_has_permission('users', 'edit')
  ) with check (
    company_id = core.current_company_id() and core.user_has_permission('users', 'edit')
  );

grant select, insert, update, delete on core.user_permissions to authenticated;

create trigger trg_audit_user_permissions
  after insert or update or delete on core.user_permissions
  for each row execute function audit.fn_row_audit();

-- Rewrite the central resolver to consult per-user grants first.
create or replace function core.user_has_permission(p_module_key text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    core.is_admin()
    or (
      exists (
        select 1 from core.user_permissions up
        where up.user_id = auth.uid() and up.company_id = core.current_company_id()
      )
      and exists (
        select 1 from core.user_permissions up
        where up.user_id = auth.uid()
          and up.company_id = core.current_company_id()
          and up.module_key = p_module_key
          and up.action = p_action
          and up.allowed
      )
    )
    or (
      not exists (
        select 1 from core.user_permissions up
        where up.user_id = auth.uid() and up.company_id = core.current_company_id()
      )
      and exists (
        select 1
        from core.user_roles ur
        join core.role_permissions rp on rp.role_id = ur.role_id and rp.allowed
        join core.permissions p on p.id = rp.permission_id
        where ur.user_id = auth.uid()
          and ur.company_id = core.current_company_id()
          and p.module_key = p_module_key
          and p.action = p_action
      )
    );
$$;

grant execute on function core.user_has_permission(text, text) to authenticated;

-- Same precedence for the batched lookup used to render pages.
create or replace function core.user_permitted_actions(p_module_key text)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when core.is_admin() then (
      select coalesce(array_agg(distinct p.action), array[]::text[])
      from core.permissions p
      where p.module_key = p_module_key
    )
    when exists (
      select 1 from core.user_permissions up
      where up.user_id = auth.uid() and up.company_id = core.current_company_id()
    ) then (
      select coalesce(array_agg(distinct up.action), array[]::text[])
      from core.user_permissions up
      where up.user_id = auth.uid()
        and up.company_id = core.current_company_id()
        and up.module_key = p_module_key
        and up.allowed
    )
    else (
      select coalesce(array_agg(distinct p.action), array[]::text[])
      from core.user_roles ur
      join core.role_permissions rp on rp.role_id = ur.role_id and rp.allowed
      join core.permissions p on p.id = rp.permission_id
      where ur.user_id = auth.uid()
        and ur.company_id = core.current_company_id()
        and p.module_key = p_module_key
    )
  end;
$$;

grant execute on function core.user_permitted_actions(text) to authenticated;

select pg_notify('pgrst', 'reload schema');
