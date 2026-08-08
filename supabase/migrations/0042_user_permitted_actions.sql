-- =============================================================================
-- Performance: batched permission lookup. Pages previously fired one
-- core.user_has_permission RPC per action (6-7 round trips to render a voucher).
-- user_permitted_actions returns every action the current user is allowed for a
-- module in a single call, using the identical role -> role_permissions ->
-- permissions joins and the same company scope, so authorization is unchanged.
-- =============================================================================

create or replace function core.user_permitted_actions(p_module_key text)
returns text[]
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(distinct p.action), array[]::text[])
  from core.user_roles ur
  join core.role_permissions rp on rp.role_id = ur.role_id and rp.allowed
  join core.permissions p on p.id = rp.permission_id
  where ur.user_id = auth.uid()
    and ur.company_id = core.current_company_id()
    and p.module_key = p_module_key;
$function$;

grant execute on function core.user_permitted_actions(text) to authenticated;

select pg_notify('pgrst', 'reload schema');
