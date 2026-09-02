-- Already applied to the live project — kept here so any other environment can
-- catch up. Safe to re-run: every step is guarded or idempotent.
--
-- 0117 — Web push: the devices to notify (core.push_subscriptions) and who to
-- notify about an approval (core.fn_approver_user_ids).
-- 0118 — fn_start_approval accepts the 'create' action, so a clerk with only
-- view + create can send their own voucher for approval (see the migration).

create table if not exists core.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references core.companies(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_company_idx
  on core.push_subscriptions (company_id, user_id);

alter table core.push_subscriptions enable row level security;

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

-- 0118
create or replace function accounting.fn_start_approval(
  p_company_id uuid,
  p_voucher_type text,
  p_voucher_id uuid,
  p_amount numeric
)
returns accounting.voucher_approvals
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_workflow accounting.approval_workflows;
  v_step accounting.approval_workflow_steps;
  v_row accounting.voucher_approvals;
begin
  if core.current_company_id() is distinct from p_company_id then
    raise exception 'Not authorized for company %', p_company_id;
  end if;
  if not (
    core.user_has_permission(p_voucher_type, 'create')
    or core.user_has_permission(p_voucher_type, 'edit')
  ) then
    raise exception 'Not authorized to submit voucher type %', p_voucher_type;
  end if;

  select * into v_workflow from accounting.approval_workflows
  where company_id = p_company_id and voucher_type = p_voucher_type and is_active;

  if v_workflow.id is not null then
    select * into v_step from accounting.approval_workflow_steps
    where workflow_id = v_workflow.id
      and (min_amount is null or p_amount >= min_amount)
      and (max_amount is null or p_amount <= max_amount)
    order by step_order asc
    limit 1;
  end if;

  insert into accounting.voucher_approvals (company_id, voucher_type, voucher_id, workflow_id, amount, current_step, status)
  values (
    p_company_id, p_voucher_type, p_voucher_id, v_workflow.id, p_amount,
    v_step.step_order, case when v_step.id is null then 'approved' else 'pending' end
  )
  on conflict (voucher_type, voucher_id) do update
    set workflow_id = excluded.workflow_id,
        amount = excluded.amount,
        current_step = excluded.current_step,
        status = excluded.status,
        updated_at = now()
  returning * into v_row;

  insert into accounting.voucher_approval_actions (voucher_approval_id, action, actor_id, comment)
  values (
    v_row.id, 'submit', auth.uid(),
    case when v_workflow.id is null then 'No approval workflow configured — auto-approved' end
  );

  return v_row;
end;
$function$;

-- 0119 — the approval functions move the journal entry's status themselves; the
-- app's separate update ran as the user and silently matched no rows for a
-- clerk holding only view + create. See the migration file for the full story.
-- (Run supabase/migrations/0119_approval_syncs_journal_status.sql — it is long
-- and reproduced there in full.)

notify pgrst, 'reload schema';
