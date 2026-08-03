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
    code: input.code,
    name: input.name,
    country: input.country || null,
    city: input.city || null,
    property_type: input.propertyType || null,
    building: input.building || null,
    plot_number: input.plotNumber || null,
    owner: input.owner || null,
    rental_status: input.rentalStatus,
  };
}

export async function createCostCenter(input: CostCenterInput) {
  const parsed = costCenterSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("cost_centers", "create");
  const companyId = await getCurrentCompanyId();

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .insert({ ...toRow(parsed.data), company_id: companyId, created_by: user.user!.id });

  if (error) return { error: error.message };

  revalidatePath("/accounting/cost-centers");
  return { success: true };
}

export async function updateCostCenter(costCenterId: string, input: CostCenterInput) {
  const parsed = costCenterSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await requirePermission("cost_centers", "edit");

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
  await requirePermission("cost_centers", "edit");

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
  await requirePermission("cost_centers", "delete");

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", costCenterId);

  if (error) return { error: error.message };

  revalidatePath("/accounting/cost-centers");
  return { success: true };
}
