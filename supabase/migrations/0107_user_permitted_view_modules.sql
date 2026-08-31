-- Returns the set of permission module_keys the current user may VIEW, using the
-- same precedence as core.user_has_permission: an admin sees every module;
-- otherwise per-user overrides (when any exist for the company) win over the
-- user's role permissions. The sidebar uses this to show only the sections a
-- user is allowed into.
create or replace function core.user_permitted_view_modules()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when core.is_admin()
      then (select coalesce(array_agg(distinct module_key), '{}') from core.permissions)
    when exists (
      select 1 from core.user_permissions up
      where up.user_id = auth.uid() and up.company_id = core.current_company_id()
    )
      then (
        select coalesce(array_agg(distinct up.module_key), '{}')
        from core.user_permissions up
        where up.user_id = auth.uid()
          and up.company_id = core.current_company_id()
          and up.action = 'view'
          and up.allowed
      )
    else (
      select coalesce(array_agg(distinct p.module_key), '{}')
      from core.user_roles ur
      join core.role_permissions rp on rp.role_id = ur.role_id and rp.allowed
      join core.permissions p on p.id = rp.permission_id
      where ur.user_id = auth.uid()
        and ur.company_id = core.current_company_id()
        and p.action = 'view'
    )
  end;
$$;

grant execute on function core.user_permitted_view_modules() to authenticated;
