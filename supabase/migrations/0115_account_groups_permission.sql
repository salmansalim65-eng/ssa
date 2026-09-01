-- Account Groups as a permission module of its own.
--
-- A group account (chart_of_accounts.is_group) shapes the whole chart, while a
-- posting account is day-to-day data entry. Both were governed by the single
-- chart_of_accounts module, so anyone allowed to add an account could also
-- restructure the chart. Account Groups is now its own module, so the two can
-- be granted separately.

insert into core.permissions (module_key, action, label)
select 'account_groups', a.action, initcap(a.action) || ' account groups'
from (values
  ('view'), ('create'), ('edit'), ('delete'), ('print'), ('export'), ('approve'), ('reject'), ('post')
) as a(action)
on conflict (module_key, action) do nothing;

-- Nobody should lose access on the day this ships: whoever can do something to
-- the chart of accounts today can do the same to its groups. An administrator
-- can then take the group rights away where the two should differ.
--
-- A user with ANY per-user grant is governed by those grants alone (see
-- core.user_permitted_actions), so their chart_of_accounts rows are carried
-- across verbatim — including a row that denies the action.
insert into core.user_permissions (user_id, company_id, module_key, action, allowed)
select up.user_id, up.company_id, 'account_groups', up.action, up.allowed
from core.user_permissions up
where up.module_key = 'chart_of_accounts'
on conflict (user_id, company_id, module_key, action) do nothing;

-- The same for role-based users.
insert into core.role_permissions (role_id, permission_id, allowed)
select rp.role_id, ag.id, rp.allowed
from core.role_permissions rp
  join core.permissions coa on coa.id = rp.permission_id and coa.module_key = 'chart_of_accounts'
  join core.permissions ag on ag.module_key = 'account_groups' and ag.action = coa.action
on conflict (role_id, permission_id) do nothing;
