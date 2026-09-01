-- Cost Centre Groups as a permission module of its own — the same split
-- migration 0115 made for account groups.
--
-- A group cost centre (cost_centers.is_group, e.g. PROPERTIES → DUBAI
-- PROPERTIES) organises the tree, while an ordinary cost centre is the thing
-- transactions are tagged with. Both were governed by the single cost_centers
-- module, so anyone allowed to add a cost centre could also restructure the
-- tree. Cost Centre Groups is now its own module, so the two can be granted
-- separately.

insert into core.permissions (module_key, action, label)
select 'cost_center_groups', a.action, initcap(a.action) || ' cost centre groups'
from (values
  ('view'), ('create'), ('edit'), ('delete'), ('print'), ('export'), ('approve'), ('reject'), ('post')
) as a(action)
on conflict (module_key, action) do nothing;

-- Nobody should lose access on the day this ships: whoever can do something to
-- cost centres today can do the same to their groups. An administrator can then
-- take the group rights away where the two should differ.
--
-- A user with ANY per-user grant is governed by those grants alone (see
-- core.user_permitted_actions), so their cost_centers rows are carried across
-- verbatim — including a row that denies the action.
insert into core.user_permissions (user_id, company_id, module_key, action, allowed)
select up.user_id, up.company_id, 'cost_center_groups', up.action, up.allowed
from core.user_permissions up
where up.module_key = 'cost_centers'
on conflict (user_id, company_id, module_key, action) do nothing;

-- The same for role-based users.
insert into core.role_permissions (role_id, permission_id, allowed)
select rp.role_id, ccg.id, rp.allowed
from core.role_permissions rp
  join core.permissions cc on cc.id = rp.permission_id and cc.module_key = 'cost_centers'
  join core.permissions ccg on ccg.module_key = 'cost_center_groups' and ccg.action = cc.action
on conflict (role_id, permission_id) do nothing;
