"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { deleteAttachment } from "@/features/attachments/actions";
import { createClient } from "@/lib/supabase/server";
import { assetSchema, type AssetInput } from "./schemas";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

function toRow(input: AssetInput) {
  return {
    asset_name: input.assetName,
    property_type: input.propertyType,
    country: input.country,
    city: input.city || null,
    area: input.area || null,
    area_sqft: input.areaSqft,
    area_unit: input.areaUnit || null,
    address: input.address || null,
    purchase_date: input.purchaseDate || null,
    purchase_value: input.purchaseValue,
    current_value: input.currentValue,
    currency_id: input.currencyId || null,
    service_charges_rate: input.serviceChargesRate,
    property_tax: input.propertyTax,
    title_deed_value: input.titleDeedValue,
    other_charges: input.otherCharges,
    estimated_rent: input.estimatedRent,
    status: input.status,
    owner: input.owner || null,
    official_owner: input.officialOwner || null,
    cost_center_mode: input.costCenterMode,
    group_cost_center_id: input.costCenterMode === "existing" ? input.groupCostCenterId || null : null,
    notes: input.notes || null,
  };
}

export async function createAsset(input: AssetInput) {
  const parsed = assetSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("assets", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data: assetCode, error: codeError } = await supabase.schema("core").rpc("fn_next_master_code", {
    p_company_id: companyId,
    p_module_key: "assets",
    p_default_prefix: "AST",
    p_default_padding: 6,
  });
  if (codeError || !assetCode) return { error: codeError?.message ?? "Failed to generate asset code" };

  const { data: asset, error } = await supabase
    .schema("assets")
    .from("assets")
    .insert({ ...toRow(parsed.data), asset_code: assetCode, company_id: companyId, created_by: user.user!.id })
    .select("id")
    .single();

  if (error || !asset) return { error: error?.message ?? "Failed to create asset" };

  // Seed the first Value History record (previous is null — this is the
  // starting value). Effective date defaults to the value-effective date, then
  // the purchase date, then today.
  if (parsed.data.currentValue != null) {
    await supabase.schema("assets").rpc("fn_log_value_change", {
      p_asset_id: asset.id,
      p_previous: null,
      p_new: parsed.data.currentValue,
      p_effective_date: parsed.data.valueEffectiveDate || parsed.data.purchaseDate || null,
      p_remarks: parsed.data.valueRemarks || null,
    });
  }

  revalidatePath("/assets");
  return { success: true, id: asset.id };
}

export async function updateAsset(assetId: string, input: AssetInput) {
  const parsed = assetSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("assets", "edit");
  const supabase = await createClient();

  // Read the stored value first so we can tell whether Current Value changed.
  const { data: existing } = await supabase
    .schema("assets")
    .from("assets")
    .select("current_value")
    .eq("id", assetId)
    .maybeSingle();

  const { error } = await supabase.schema("assets").from("assets").update(toRow(parsed.data)).eq("id", assetId);
  if (error) return { error: error.message };

  // Log a Value History record only when the value truly changed — saving the
  // same value again must not create a duplicate record.
  const previous = existing?.current_value ?? null;
  const next = parsed.data.currentValue;
  if (next != null && Number(previous ?? NaN) !== Number(next)) {
    await supabase.schema("assets").rpc("fn_log_value_change", {
      p_asset_id: assetId,
      p_previous: previous,
      p_new: next,
      p_effective_date: parsed.data.valueEffectiveDate || null,
      p_remarks: parsed.data.valueRemarks || null,
    });
  }

  revalidatePath("/assets");
  revalidatePath(`/assets/${assetId}`);
  return { success: true };
}

export async function deleteAsset(assetId: string) {
  await requirePermission("assets", "delete");
  const supabase = await createClient();

  // Definer function guards references (leases, sales, purchase lines, and the
  // asset's cost-centre transactions), then soft-deletes the asset and
  // deactivates its cost centre. It runs as definer because stamping deleted_at
  // through the RLS-scoped client is rejected by the `deleted_at IS NULL`
  // select policy.
  const { error } = await supabase.schema("assets").rpc("fn_soft_delete_asset", { p_id: assetId });
  if (error) return { error: error.message };

  revalidatePath("/assets");
  return { success: true };
}

export async function deleteValueHistory(historyId: string, assetId: string) {
  await requirePermission("asset_value_history", "delete");
  const supabase = await createClient();

  // Definer RPC validates the permission, deletes the record, and recomputes
  // current_value from the latest remaining history row so it stays consistent.
  const { error } = await supabase.schema("assets").rpc("fn_delete_value_history", { p_id: historyId });
  if (error) return { error: error.message };

  revalidatePath(`/assets/${assetId}`);
  return { success: true };
}

export async function setAssetTitleDeed(assetId: string, attachmentId: string | null) {
  await requirePermission("assets", "edit");
  const supabase = await createClient();
  const { error } = await supabase
    .schema("assets")
    .from("assets")
    .update({ title_deed_attachment_id: attachmentId })
    .eq("id", assetId);
  if (error) return { error: error.message };

  revalidatePath(`/assets/${assetId}`);
  return { success: true };
}

export async function attachAssetImage(assetId: string, attachmentId: string, isPrimary: boolean) {
  await requirePermission("assets", "edit");
  const supabase = await createClient();

  if (isPrimary) {
    await supabase.schema("assets").from("asset_images").update({ is_primary: false }).eq("asset_id", assetId);
  }

  const { error } = await supabase
    .schema("assets")
    .from("asset_images")
    .insert({ asset_id: assetId, attachment_id: attachmentId, is_primary: isPrimary });
  if (error) return { error: error.message };

  revalidatePath(`/assets/${assetId}`);
  return { success: true };
}

export async function setAssetImagePrimary(imageId: string, assetId: string) {
  await requirePermission("assets", "edit");
  const supabase = await createClient();

  await supabase.schema("assets").from("asset_images").update({ is_primary: false }).eq("asset_id", assetId);
  const { error } = await supabase.schema("assets").from("asset_images").update({ is_primary: true }).eq("id", imageId);
  if (error) return { error: error.message };

  revalidatePath(`/assets/${assetId}`);
  return { success: true };
}

export async function removeAssetImage(imageId: string, assetId: string, attachmentId: string) {
  await requirePermission("assets", "edit");
  const supabase = await createClient();

  const { error } = await supabase.schema("assets").from("asset_images").delete().eq("id", imageId);
  if (error) return { error: error.message };

  await deleteAttachment(attachmentId);

  revalidatePath(`/assets/${assetId}`);
  return { success: true };
}
