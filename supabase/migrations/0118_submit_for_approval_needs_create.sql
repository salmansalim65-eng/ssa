-- Submitting a voucher for approval is part of RAISING it, not of editing it.
--
-- fn_start_approval demanded the 'edit' action, so a user granted only view +
-- create (the natural set for a data-entry clerk) could not submit at all: the
-- automatic hand-off silently failed and the voucher sat in Draft, with the
-- manual "Submit for approval" button hidden for the same reason. Whoever may
-- create the voucher type may now submit it; an editor may still submit one
-- they are amending.
--
-- Everything else about the function is unchanged.

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
