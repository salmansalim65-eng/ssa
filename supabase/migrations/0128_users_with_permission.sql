-- Who, in a company, holds a given permission.
--
-- core.user_has_permission() answers this for the CALLER, which is no use to a
-- background job: the lease-renewal alert runs on a schedule with no session, so
-- it needs to look the audience up by company. This is the same resolution rule
-- as user_has_permission and fn_approver_user_ids — a system role sees
-- everything; otherwise a user's own per-user grants win when they have any, and
-- their roles decide when they have none — generalised to any module and action.

create or replace function core.fn_users_with_permission(
  p_company_id uuid,
  p_module_key text,
  p_action text
)
returns table(user_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  select uc.user_id
  from core.user_companies uc
  where uc.company_id = p_company_id
    and (
      exists (
        select 1
        from core.user_roles ur
          join core.roles r on r.id = ur.role_id
        where ur.user_id = uc.user_id
          and ur.company_id = p_company_id
          and r.is_system_role
      )
      or (
        exists (
          select 1 from core.user_permissions up
          where up.user_id = uc.user_id and up.company_id = p_company_id
        )
        and exists (
          select 1 from core.user_permissions up
          where up.user_id = uc.user_id
            and up.company_id = p_company_id
            and up.module_key = p_module_key
            and up.action = p_action
            and up.allowed
        )
      )
      or (
        not exists (
          select 1 from core.user_permissions up
          where up.user_id = uc.user_id and up.company_id = p_company_id
        )
        and exists (
          select 1
          from core.user_roles ur
            join core.role_permissions rp on rp.role_id = ur.role_id and rp.allowed
            join core.permissions p on p.id = rp.permission_id
          where ur.user_id = uc.user_id
            and ur.company_id = p_company_id
            and p.module_key = p_module_key
            and p.action = p_action
        )
      )
    );
$$;

grant execute on function core.fn_users_with_permission(uuid, text, text) to authenticated, service_role;
