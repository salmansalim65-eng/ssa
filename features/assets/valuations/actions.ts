"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { valuationSchema, type ValuationInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

export async function createValuation(assetId: string, input: ValuationInput) {
  const parsed = valuationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("asset_valuations", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase.schema("assets").from("asset_valuations").insert({
    company_id: companyId,
    asset_id: assetId,
    valuation_date: parsed.data.valuationDate,
    market_value: parsed.data.marketValue,
    valuer: parsed.data.valuer || null,
    notes: parsed.data.notes || null,
    created_by: user.user!.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/reports/asset-valuation");
  return { success: true };
}

export async function deleteValuation(valuationId: string, assetId: string) {
  await requirePermission("asset_valuations", "delete");
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase
    .schema("assets")
    .from("asset_valuations")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.user!.id })
    .eq("id", valuationId);
  if (error) return { error: error.message };

  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/reports/asset-valuation");
  return { success: true };
}
