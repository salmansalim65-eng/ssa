-- =============================================================================
-- Fixes 12 `function_search_path_mutable` findings surfaced by Supabase's
-- security advisor: these functions had no `search_path` pinned, leaving
-- them more susceptible to search-path-based object shadowing (a caller
-- able to create objects earlier in their own search_path could otherwise
-- trick an unqualified reference inside the function into resolving to
-- their object instead of the intended one). Every function below is
-- re-declared identically to its original definition, with
-- `set search_path = public` added — no behavior change otherwise.
-- =============================================================================

create or replace function core.fn_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function core.fn_custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  claims jsonb;
  v_user_id uuid := (event ->> 'user_id')::uuid;
  v_company_id uuid;
begin
  select default_company_id into v_company_id
  from core.user_profiles
  where id = v_user_id;

  claims := coalesce(event -> 'claims', '{}'::jsonb);

  if v_company_id is not null then
    claims := jsonb_set(claims, '{app_metadata,company_id}', to_jsonb(v_company_id::text));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

create or replace function core.fn_convert_to_base(
  p_company_id uuid,
  p_currency_id uuid,
  p_amount numeric,
  p_as_of_date date default current_date
)
returns numeric
language sql
stable
set search_path = public
as $$
  select p_amount * core.fn_exchange_rate_to_base(p_company_id, p_currency_id, p_as_of_date);
$$;

create or replace function core.fn_upsert_exchange_rate(
  p_company_id uuid,
  p_currency_id uuid,
  p_rate_date date,
  p_rate_to_base numeric
)
returns core.exchange_rates
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row core.exchange_rates;
begin
  insert into core.exchange_rates (company_id, currency_id, rate_date, rate_to_base, created_by)
  values (p_company_id, p_currency_id, p_rate_date, p_rate_to_base, auth.uid())
  on conflict (company_id, currency_id, rate_date)
    do update set rate_to_base = excluded.rate_to_base, updated_by = auth.uid(), updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function accounting.fn_validate_account_hierarchy()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent accounting.chart_of_accounts;
begin
  if new.parent_id is not null then
    select * into v_parent from accounting.chart_of_accounts where id = new.parent_id;

    if v_parent is null then
      raise exception 'Parent account % does not exist', new.parent_id;
    end if;
    if v_parent.company_id <> new.company_id then
      raise exception 'Parent account belongs to a different company';
    end if;
    if v_parent.account_type <> new.account_type then
      raise exception 'Child account_type (%) must match parent account_type (%)', new.account_type, v_parent.account_type;
    end if;
    if not v_parent.is_group then
      raise exception 'Parent account % is not a group account and cannot have children', v_parent.account_code;
    end if;
  end if;

  return new;
end;
$$;

create or replace function accounting.fn_check_account_no_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ancestor_id uuid;
begin
  if new.parent_id is null or new.parent_id = old.parent_id then
    return new;
  end if;

  v_ancestor_id := new.parent_id;
  while v_ancestor_id is not null loop
    if v_ancestor_id = new.id then
      raise exception 'Cannot re-parent account: would create a cycle';
    end if;
    select parent_id into v_ancestor_id from accounting.chart_of_accounts where id = v_ancestor_id;
  end loop;

  return new;
end;
$$;

create or replace function accounting.fn_prevent_delete_with_children()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    if exists (
      select 1 from accounting.chart_of_accounts
      where parent_id = new.id and deleted_at is null
    ) then
      raise exception 'Cannot delete account %: it still has active child accounts', new.account_code;
    end if;
  end if;

  return new;
end;
$$;

create or replace function accounting.fn_prevent_posting_to_group_account()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_is_group boolean;
begin
  select is_group into v_is_group from accounting.chart_of_accounts where id = new.account_id;
  if v_is_group then
    raise exception 'Cannot post to a group/header account';
  end if;
  return new;
end;
$$;

create or replace function accounting.fn_prevent_posted_entry_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'posted' then
    raise exception 'Journal entry % is posted and cannot be modified', old.id;
  end if;
  return new;
end;
$$;

create or replace function accounting.fn_prevent_posted_line_changes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from accounting.journal_entries
  where id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if v_status = 'posted' then
    raise exception 'Journal entry lines cannot change once the entry is posted';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function accounting.fn_enforce_balanced_entry()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_debit numeric(18,2);
  v_credit numeric(18,2);
begin
  if new.status = 'posted' and old.status <> 'posted' then
    if not core.user_has_permission(new.voucher_type, 'post') then
      raise exception 'Not permitted to post %', new.voucher_type;
    end if;

    select coalesce(sum(base_debit_amount), 0), coalesce(sum(base_credit_amount), 0)
      into v_debit, v_credit
    from accounting.journal_entry_lines
    where journal_entry_id = new.id;

    if v_debit = 0 and v_credit = 0 then
      raise exception 'Cannot post an empty journal entry';
    end if;
    if v_debit <> v_credit then
      raise exception 'Journal entry is not balanced: debit % <> credit %', v_debit, v_credit;
    end if;

    new.posted_by := auth.uid();
    new.posted_at := now();
  end if;

  return new;
end;
$$;

create or replace function accounting.fn_get_posting_account(
  p_company_id uuid, p_voucher_type text, p_account_role text
)
returns uuid
language sql
stable
set search_path = public
as $$
  select account_id from accounting.posting_templates
  where company_id = p_company_id and voucher_type = p_voucher_type and account_role = p_account_role;
$$;
