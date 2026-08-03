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
    asset_code: input.assetCode,
    asset_name: input.assetName,
    property_type: input.propertyType,
    country: input.country,
    city: input.city || null,
    area: input.area || null,
    address: input.address || null,
    purchase_date: input.purchaseDate || null,
    purchase_value: input.purchaseValue,
    current_value: input.currentValue,
    status: input.status,
    owner: input.owner || null,
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

  const { data: asset, error } = await supabase
    .schema("assets")
    .from("assets")
    .insert({ ...toRow(parsed.data), company_id: companyId, created_by: user.user!.id })
    .select("id")
    .single();

  if (error || !asset) return { error: error?.message ?? "Failed to create asset" };

  revalidatePath("/assets");
  return { success: true, id: asset.id };
}

export async function updateAsset(assetId: string, input: AssetInput) {
  const parsed = assetSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("assets", "edit");
  const supabase = await createClient();
  const { error } = await supabase.schema("assets").from("assets").update(toRow(parsed.data)).eq("id", assetId);
  if (error) return { error: error.message };

  revalidatePath("/assets");
  revalidatePath(`/assets/${assetId}`);
  return { success: true };
}

export async function deleteAsset(assetId: string) {
  await requirePermission("assets", "delete");
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase
    .schema("assets")
    .from("assets")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.user!.id })
    .eq("id", assetId);
  if (error) return { error: error.message };

  revalidatePath("/assets");
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
