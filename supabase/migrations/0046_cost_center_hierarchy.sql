-- Cost centers become hierarchical (Operations > Transport > Jeddah, etc.).
alter table accounting.cost_centers
  add column if not exists parent_id uuid references accounting.cost_centers(id) on delete restrict;

create index if not exists idx_cost_centers_parent on accounting.cost_centers(parent_id);

-- Parent must be in the same company; no self-parent and no cycles.
create or replace function accounting.fn_validate_cost_center_hierarchy()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_parent_company uuid;
  v_cursor uuid;
  v_guard int := 0;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'A cost center cannot be its own parent';
    end if;
    select company_id into v_parent_company from accounting.cost_centers where id = new.parent_id;
    if v_parent_company is null or v_parent_company <> new.company_id then
      raise exception 'Parent cost center must belong to the same company';
    end if;
    v_cursor := new.parent_id;
    while v_cursor is not null loop
      v_guard := v_guard + 1;
      if v_cursor = new.id then
        raise exception 'Cost center hierarchy cannot contain a cycle';
      end if;
      if v_guard > 100 then
        raise exception 'Cost center hierarchy is too deep';
      end if;
      select parent_id into v_cursor from accounting.cost_centers where id = v_cursor;
    end loop;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_validate_cost_center_hierarchy on accounting.cost_centers;
create trigger trg_validate_cost_center_hierarchy
  before insert or update of parent_id, company_id on accounting.cost_centers
  for each row execute function accounting.fn_validate_cost_center_hierarchy();
