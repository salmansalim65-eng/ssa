-- Admin "delete" for a POSTED asset sale actually removes it (rather than
-- leaving a reversed document behind that can't be deleted again): reverts the
-- sold asset back to active, deletes the sale (lines cascade), then deletes its
-- journal entry (lines cascade, plus any reversal that pointed at it).
create or replace function assets.fn_admin_delete_posted_asset_sale(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_je uuid;
  v_asset uuid;
begin
  if not core.is_admin() then
    raise exception 'Only administrators can delete posted asset sales';
  end if;

  select company_id, journal_entry_id, asset_id into v_company, v_je, v_asset
  from assets.asset_sales where id = p_id;
  if v_company is null then
    raise exception 'Asset sale not found';
  end if;
  if core.current_company_id() is distinct from v_company then
    raise exception 'Not authorized for this company';
  end if;

  if v_asset is not null then
    update assets.assets set status = 'active' where id = v_asset and status = 'sold';
  end if;

  delete from assets.asset_sales where id = p_id;  -- asset_sale_lines cascade

  if v_je is not null then
    delete from accounting.journal_entries where reversal_of = v_je;  -- drop any reversal of it
    delete from accounting.journal_entries where id = v_je;           -- journal_entry_lines cascade
  end if;
end;
$function$;

grant execute on function assets.fn_admin_delete_posted_asset_sale(uuid) to authenticated;
