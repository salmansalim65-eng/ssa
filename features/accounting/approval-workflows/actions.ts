"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { VoucherType } from "@/lib/vouchers/meta";
import { stepSchema, type StepInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

async function getOrCreateWorkflow(companyId: string, voucherType: VoucherType) {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .schema("accounting")
    .from("approval_workflows")
    .select("id")
    .eq("company_id", companyId)
    .eq("voucher_type", voucherType)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: user } = await supabase.auth.getUser();
  const { data: created, error } = await supabase
    .schema("accounting")
    .from("approval_workflows")
    .insert({ company_id: companyId, voucher_type: voucherType, created_by: user.user!.id })
    .select("id")
    .single();

  if (error || !created) throw new Error(error?.message ?? "Failed to create workflow");
  return created.id;
}

export async function setWorkflowActive(voucherType: VoucherType, isActive: boolean) {
  await requirePermission("approval_workflows", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .schema("accounting")
    .from("approval_workflows")
    .select("id")
    .eq("company_id", companyId)
    .eq("voucher_type", voucherType)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .schema("accounting")
      .from("approval_workflows")
      .update({ is_active: isActive })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase
      .schema("accounting")
      .from("approval_workflows")
      .insert({ company_id: companyId, voucher_type: voucherType, is_active: isActive, created_by: user.user!.id });
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/approval-workflows");
  return { success: true };
}

export async function addWorkflowStep(voucherType: VoucherType, input: StepInput) {
  const parsed = stepSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("approval_workflows", "edit");
  const companyId = await getCurrentCompanyId();
  const workflowId = await getOrCreateWorkflow(companyId, voucherType);

  const supabase = await createClient();
  const { data: lastStep } = await supabase
    .schema("accounting")
    .from("approval_workflow_steps")
    .select("step_order")
    .eq("workflow_id", workflowId)
    .order("step_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (lastStep?.step_order ?? 0) + 1;

  const { error } = await supabase.schema("accounting").from("approval_workflow_steps").insert({
    workflow_id: workflowId,
    step_order: nextOrder,
    approver_role_id: parsed.data.approverRoleId,
    min_amount: parsed.data.minAmount ? Number(parsed.data.minAmount) : null,
    max_amount: parsed.data.maxAmount ? Number(parsed.data.maxAmount) : null,
  });

  if (error) return { error: error.message };

  revalidatePath("/admin/approval-workflows");
  return { success: true };
}

export async function deleteWorkflowStep(stepId: string) {
  await requirePermission("approval_workflows", "delete");

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("approval_workflow_steps")
    .delete()
    .eq("id", stepId);

  if (error) return { error: error.message };

  revalidatePath("/admin/approval-workflows");
  return { success: true };
}
