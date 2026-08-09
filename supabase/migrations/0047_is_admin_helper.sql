-- True when the current user holds a system role (Administrator) in the active
-- company. Used to let admins skip the approval step (create -> auto-post),
-- while all posting validation still runs in the posting trigger.
create or replace function core.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from core.user_roles ur
    join core.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and ur.company_id = core.current_company_id()
      and r.is_system_role
  );
$function$;

grant execute on function core.is_admin() to authenticated;
