-- The rent statement needs a place in the permission matrix.
--
-- hasPermission('rent_statement', ...) answers false for a module nobody has
-- heard of, so without this the screen is unreachable — including by an
-- administrator, who would see a menu entry that leads nowhere.
--
-- The same actions the expense voucher has, so the matrix screen offers the
-- new voucher the same tick boxes as the others rather than a short list of
-- its own.
insert into core.permissions (module_key, action, label)
select 'rent_statement', p.action,
       case p.action
         when 'view'   then 'View rent statements'
         when 'create' then 'Create rent statements'
         when 'edit'   then 'Edit rent statements'
         when 'delete' then 'Delete rent statements'
         when 'post'   then 'Post rent statements'
         when 'approve' then 'Approve rent statements'
         when 'reject' then 'Reject rent statements'
         when 'print'  then 'Print rent statements'
         when 'export' then 'Export rent statements'
         else initcap(p.action) || ' rent statements'
       end
  from (select distinct action from core.permissions where module_key = 'expense_voucher') p
 where not exists (
   select 1 from core.permissions x where x.module_key = 'rent_statement' and x.action = p.action
 );

-- Every system role gets the lot, as it has for every other voucher: a system
-- role is the administrator, and an administrator that cannot open a screen it
-- can see in the menu is a bug rather than a policy.
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
  from core.roles r
  cross join core.permissions p
 where r.is_system_role
   and p.module_key = 'rent_statement'
   and not exists (
     select 1 from core.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id
   );
