-- The approval functions now move the journal entry's status themselves.
--
-- Until now the app made a second, separate update to journal_entries after
-- calling fn_start_approval / fn_approval_action. That update runs as the user,
-- and journal_entries_update requires edit / post / approve / reject on the
-- voucher type — which a data-entry clerk (view + create) does not have. The
-- update therefore matched NO rows, and an update matching no rows is not an
-- error, so the app believed it had succeeded.
--
-- The result was a voucher split in half: accounting.voucher_approvals said
-- 'pending' (so the header bell counted it) while journal_entries still said
-- 'draft' (so the voucher showed as a draft, offered "Submit for approval"
-- again, and never appeared in the pending list, which reads the entry status).
--
-- Both statuses are now written inside the same SECURITY DEFINER function, in
-- one transaction, so they can never disagree again. Posted entries are left
-- alone: their status is final.

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
  -- Submitting is part of RAISING the voucher, so create is enough (0118).
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

  -- Keep the entry in step with the approval, as the same user who could not do
  -- it for themselves.
  update accounting.journal_entries
  set status = v_row.status
  where company_id = p_company_id
    and voucher_type = p_voucher_type
    and voucher_id = p_voucher_id
    and status <> 'posted';

  return v_row;
end;
$function$;

create or replace function accounting.fn_approval_action(
  p_voucher_approval_id uuid,
  p_action text,
  p_comment text default null::text
)
returns accounting.voucher_approvals
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_approval accounting.voucher_approvals;
  v_step accounting.approval_workflow_steps;
  v_next_step accounting.approval_workflow_steps;
  v_is_authorized boolean;
begin
  if p_action not in ('approve','reject','send_back') then
    raise exception 'Invalid approval action %', p_action;
  end if;

  select * into v_approval from accounting.voucher_approvals where id = p_voucher_approval_id;
  if v_approval.id is null then
    raise exception 'Approval record not found';
  end if;
  if v_approval.status <> 'pending' then
    raise exception 'Voucher is not pending approval (status: %)', v_approval.status;
  end if;

  select * into v_step from accounting.approval_workflow_steps
  where workflow_id = v_approval.workflow_id and step_order = v_approval.current_step;

  select exists (
    select 1 from core.user_roles
    where user_id = auth.uid()
      and company_id = v_approval.company_id
      and role_id = v_step.approver_role_id
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized to act on step % of this approval', v_approval.current_step;
  end if;

  insert into accounting.voucher_approval_actions (voucher_approval_id, step_order, action, actor_id, comment)
  values (v_approval.id, v_approval.current_step, p_action, auth.uid(), p_comment);

  if p_action = 'reject' then
    update accounting.voucher_approvals set status = 'rejected', updated_at = now()
    where id = v_approval.id returning * into v_approval;
  elsif p_action = 'send_back' then
    update accounting.voucher_approvals set status = 'sent_back', current_step = null, updated_at = now()
    where id = v_approval.id returning * into v_approval;
  else
    select * into v_next_step from accounting.approval_workflow_steps
    where workflow_id = v_approval.workflow_id
      and step_order > v_approval.current_step
      and (min_amount is null or v_approval.amount >= min_amount)
      and (max_amount is null or v_approval.amount <= max_amount)
    order by step_order asc
    limit 1;

    if v_next_step.id is null then
      update accounting.voucher_approvals set status = 'approved', current_step = null, updated_at = now()
      where id = v_approval.id returning * into v_approval;
    else
      update accounting.voucher_approvals set current_step = v_next_step.step_order, updated_at = now()
      where id = v_approval.id returning * into v_approval;
    end if;
  end if;

  -- Same as above: the decision moves the entry, not a second call from the app.
  update accounting.journal_entries
  set status = v_approval.status
  where company_id = v_approval.company_id
    and voucher_type = v_approval.voucher_type
    and voucher_id = v_approval.voucher_id
    and status <> 'posted';

  return v_approval;
end;
$function$;

-- Repair the vouchers already split by the old behaviour: an approval that says
-- pending/approved/rejected/sent_back while its entry is still a draft.
update accounting.journal_entries je
set status = va.status
from accounting.voucher_approvals va
where va.company_id = je.company_id
  and va.voucher_type = je.voucher_type
  and va.voucher_id = je.voucher_id
  and je.status = 'draft'
  and va.status <> 'draft';
