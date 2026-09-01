"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { costCenterSchema, type CostCenterInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

function toRow(input: CostCenterInput) {
  return {
    name: input.name,
    is_group: input.isGroup,
    parent_id: input.parentId || null,
    country: input.country || null,
    city: input.city || null,
    property_type: input.propertyType || null,
    building: input.building || null,
    plot_number: input.plotNumber || null,
    owner: input.owner || null,
    rental_status: input.rentalStatus,
  };
}

/**
 * Which permission module governs a cost centre. A GROUP cost centre organises
 * the tree, so it is governed by `cost_center_groups`; an ordinary one, the
 * thing transactions are tagged with, by `cost_centers`. That lets an
 * administrator let someone add cost centres without restructuring the tree.
 */
function costCenterModule(isGroup: boolean) {
  return isGroup ? "cost_center_groups" : "cost_centers";
}

/** The stored group flag of a cost centre, so a write can be checked against it. */
async function isGroupCostCenter(costCenterId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .select("is_group")
    .eq("id", costCenterId)
    .maybeSingle();
  return Boolean(data?.is_group);
}

export async function createCostCenter(input: CostCenterInput) {
  const parsed = costCenterSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission(costCenterModule(parsed.data.isGroup), "create");
  const companyId = await getCurrentCompanyId();

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data: code, error: codeError } = await supabase.schema("core").rpc("fn_next_master_code", {
    p_company_id: companyId,
    p_module_key: "cost_centers",
    p_default_prefix: "CC",
    p_default_padding: 6,
  });
  if (codeError || !code) return { error: codeError?.message ?? "Failed to generate cost center code" };

  const { error } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .insert({ ...toRow(parsed.data), code, company_id: companyId, created_by: user.user!.id });

  if (error) return { error: error.message };

  revalidatePath("/accounting/cost-centers");
  return { success: true };
}

export async function updateCostCenter(costCenterId: string, input: CostCenterInput) {
  const parsed = costCenterSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Checked against what the cost centre IS — and, when it is being converted
  // between a group and an ordinary one, against what it is becoming too.
  const wasGroup = await isGroupCostCenter(costCenterId);
  await requirePermission(costCenterModule(wasGroup), "edit");
  if (parsed.data.isGroup !== wasGroup) {
    await requirePermission(costCenterModule(parsed.data.isGroup), "edit");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .update(toRow(parsed.data))
    .eq("id", costCenterId);

  if (error) return { error: error.message };

  revalidatePath("/accounting/cost-centers");
  return { success: true };
}

export async function setCostCenterActive(costCenterId: string, isActive: boolean) {
  await requirePermission(costCenterModule(await isGroupCostCenter(costCenterId)), "edit");

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .update({ is_active: isActive })
    .eq("id", costCenterId);

  if (error) return { error: error.message };

  revalidatePath("/accounting/cost-centers");
  return { success: true };
}

export async function deleteCostCenter(costCenterId: string) {
  await requirePermission(costCenterModule(await isGroupCostCenter(costCenterId)), "delete");

  const supabase = await createClient();
  // Soft-delete via SECURITY DEFINER RPC: stamping deleted_at through the
  // RLS-scoped client is rejected because the SELECT policy filters
  // `deleted_at IS NULL` (see migration 0059).
  const { error } = await supabase
    .schema("accounting")
    .rpc("fn_soft_delete_cost_center", { p_id: costCenterId });

  if (error) return { error: error.message };

  revalidatePath("/accounting/cost-centers");
  return { success: true };
}
