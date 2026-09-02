-- Web push: the devices to notify, and who to notify about an approval.
--
-- A voucher arriving for approval only showed up once the approver happened to
-- open the app. With a subscription per device, the server can push a phone
-- notification the moment the voucher is submitted — the app does not have to
-- be open.

create table if not exists core.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references core.companies(id) on delete cascade,
  -- The browser's push endpoint identifies the device+browser, so it is the
  -- natural key: re-subscribing the same device updates its keys in place.
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_company_idx
  on core.push_subscriptions (company_id, user_id);

alter table core.push_subscriptions enable row level security;

-- A device belongs to one person: only they may see or manage it. The sender
-- runs with the service role, which bypasses these policies.
drop policy if exists push_subscriptions_select on core.push_subscriptions;
create policy push_subscriptions_select on core.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists push_subscriptions_insert on core.push_subscriptions;
create policy push_subscriptions_insert on core.push_subscriptions
  for insert with check (user_id = auth.uid() and company_id = core.current_company_id());

drop policy if exists push_subscriptions_update on core.push_subscriptions;
create policy push_subscriptions_update on core.push_subscriptions
  for update using (user_id = auth.uid());

drop policy if exists push_subscriptions_delete on core.push_subscriptions;
create policy push_subscriptions_delete on core.push_subscriptions
  for delete using (user_id = auth.uid());

-- Everyone in the company who may APPROVE a given module, resolved exactly the
-- way core.user_permitted_actions resolves the current user's own actions:
-- an administrator holds every action; a user carrying any per-user grant is
-- governed by those alone; everyone else inherits their roles' grants.
create or replace function core.fn_approver_user_ids(p_company_id uuid, p_module_key text)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
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
            and up.action = 'approve'
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
            and p.action = 'approve'
        )
      )
    );
$$;

grant execute on function core.fn_approver_user_ids(uuid, text) to authenticated;
