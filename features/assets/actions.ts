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
    address: input.address || null,
    purchase_date: input.purchaseDate || null,
    purchase_value: input.purchaseValue,
    current_value: input.currentValue,
    currency_id: input.currencyId || null,
    service_charges_rate: input.serviceChargesRate,
    title_deed_value: input.titleDeedValue,
    estimated_rent: input.estimatedRent,
    status: input.status,
    owner: input.owner || null,
    group_cost_center_id: input.groupCostCenterId || null,
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

  // Refuse deletion when the asset is referenced by leases, sales or purchase
  // lines, or when its (auto-created) cost centre already carries accounting
  // entries — deleting would orphan financial history.
  const rental = supabase.schema("rental");
  const assetsSchema = supabase.schema("assets");
  const acc = supabase.schema("accounting");

  const { data: costCenter } = await acc
    .from("cost_centers")
    .select("id")
    .eq("asset_id", assetId)
    .maybeSingle();

  const [{ count: uaeLeases }, { count: pkLeases }, { count: sales }, { count: purchaseLines }] = await Promise.all([
    rental.from("uae_leases").select("id", { count: "exact", head: true }).eq("asset_id", assetId),
    rental.from("pk_leases").select("id", { count: "exact", head: true }).eq("asset_id", assetId),
    assetsSchema.from("asset_sales").select("id", { count: "exact", head: true }).eq("asset_id", assetId),
    acc.from("purchase_voucher_lines").select("id", { count: "exact", head: true }).eq("asset_id", assetId),
  ]);

  let ccEntries = 0;
  if (costCenter?.id) {
    const { count } = await acc
      .from("journal_entry_lines")
      .select("id", { count: "exact", head: true })
      .eq("cost_center_id", costCenter.id);
    ccEntries = count ?? 0;
  }

  if ((uaeLeases ?? 0) + (pkLeases ?? 0) + (sales ?? 0) + (purchaseLines ?? 0) + ccEntries > 0) {
    return {
      error:
        "This asset cannot be deleted because it is used by leases, sales, purchases or posted accounting entries.",
    };
  }

  const { error } = await supabase
    .schema("assets")
    .from("assets")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.user!.id })
    .eq("id", assetId);
  if (error) return { error: error.message };

  // Deactivate the asset's now-unused cost centre so it drops out of pickers.
  if (costCenter?.id) {
    await acc.from("cost_centers").update({ is_active: false }).eq("id", costCenter.id);
  }

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
