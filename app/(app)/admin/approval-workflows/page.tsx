import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { VOUCHER_TYPES } from "@/lib/vouchers/meta";
import { ApprovalWorkflowsManager, type WorkflowInfo } from "./approval-workflows-manager";

export default async function ApprovalWorkflowsPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: workflows }, { data: roles }, canEdit, canDelete] = await Promise.all([
    supabase
      .schema("accounting")
      .from("approval_workflows")
      .select("id, voucher_type, is_active")
      .eq("company_id", companyId),
    supabase.schema("core").from("roles").select("id, name").eq("company_id", companyId).is("deleted_at", null),
    hasPermission("approval_workflows", "edit"),
    hasPermission("approval_workflows", "delete"),
  ]);

  const workflowIds = (workflows ?? []).map((w) => w.id);
  const { data: steps } = workflowIds.length
    ? await supabase
        .schema("accounting")
        .from("approval_workflow_steps")
        .select("id, workflow_id, step_order, min_amount, max_amount, approver_role_id")
        .in("workflow_id", workflowIds)
        .order("step_order")
    : { data: [] };

  type RawStep = {
    id: string;
    workflow_id: string;
    step_order: number;
    min_amount: number | null;
    max_amount: number | null;
    approver_role_id: string | null;
  };

  const stepRows = (steps as unknown as RawStep[]) ?? [];
  // roles live in the `core` schema (cross-schema from accounting).
  const rolesById = await fetchRefs<{ id: string; name: string }>(
    supabase, "core", "roles", "name", stepRows.map((s) => s.approver_role_id),
  );

  const workflowByVoucherType: Record<string, WorkflowInfo> = {};
  for (const w of workflows ?? []) {
    workflowByVoucherType[w.voucher_type] = {
      isActive: w.is_active,
      steps: stepRows
        .filter((s) => s.workflow_id === w.id)
        .map((s) => ({
          id: s.id,
          stepOrder: s.step_order,
          roleName: rolesById.get(s.approver_role_id ?? "")?.name ?? "—",
          minAmount: s.min_amount,
          maxAmount: s.max_amount,
        })),
    };
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approval Workflows</h1>
        <p className="text-sm text-muted-foreground">
          Configure multi-level approval per voucher type. Steps run in
          order; an amount range restricts a step to vouchers within it. A
          voucher type with no active workflow (or no matching step) posts
          without approval.
        </p>
      </div>
      <ApprovalWorkflowsManager
        voucherTypes={[...VOUCHER_TYPES]}
        workflowByVoucherType={workflowByVoucherType}
        roles={roles ?? []}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
