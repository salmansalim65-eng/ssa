-- Asset Sale header gains Payment Terms + Due Date (informational; historical
-- rows keep NULL). No posting/accounting impact.
alter table assets.asset_sales
  add column if not exists payment_terms text,
  add column if not exists due_date date;

-- Asset Register surfaces the asset's assigned (group) cost center. The 1:1
-- dedicated cost center is internal; the group cost center is the one users
-- assign, so "None" is meaningful when it is unset. security_invoker preserved.
create or replace view reporting.v_asset_register
with (security_invoker = on) as
  select a.id as asset_id,
    a.company_id,
    a.asset_code,
    a.asset_name,
    a.property_type,
    a.country,
    a.city,
    a.area,
    a.owner,
    a.status,
    a.purchase_date,
    a.purchase_value,
    a.current_value,
    gcc.code as cost_center_code,
    gcc.name as cost_center_name
  from assets.assets a
  left join accounting.cost_centers gcc
    on gcc.id = a.group_cost_center_id and gcc.deleted_at is null
  where a.deleted_at is null;
