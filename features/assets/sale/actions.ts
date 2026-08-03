"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { assetSaleSchema, type AssetSaleInput } from "./schemas";

async function getPostingAccount(companyId: string, accountRole: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("accounting").rpc("fn_get_posting_account", {
    p_company_id: companyId,
    p_voucher_type: "asset_sales",
    p_account_role: accountRole,
  });
  if (error) throw new Error(error.message);
  return data as string | null;
}

export async function createAssetSale(input: AssetSaleInput) {
  const parsed = assetSaleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("asset_sales", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const { data: asset, error: assetError } = await supabase
    .schema("assets")
    .from("assets")
    .select("status, current_value, purchase_value")
    .eq("id", parsed.data.assetId)
    .single();
  if (assetError || !asset) return { error: "Asset not found" };
  if (asset.status === "sold") return { error: "This asset has already been sold" };

  const bookValue = asset.current_value ?? 0;
  const purchaseValue = asset.purchase_value ?? 0;
  const profitLoss = parsed.data.salePrice - bookValue;

  const [receivableId, fixedAssetId, gainId, lossId] = await Promise.all([
    getPostingAccount(companyId, "sale_proceeds_receivable"),
    getPostingAccount(companyId, "fixed_asset_property"),
    getPostingAccount(companyId, "gain_on_sale"),
    getPostingAccount(companyId, "loss_on_sale"),
  ]);
  if (!receivableId || !fixedAssetId) {
    return {
      error: "Configure Posting Templates for Asset Sale first (Sale Proceeds Receivable + Fixed Asset accounts).",
    };
  }
  if (profitLoss > 0 && !gainId) {
    return { error: "Configure the Gain on Sale of Asset account in Posting Templates first." };
  }
  if (profitLoss < 0 && !lossId) {
    return { error: "Configure the Loss on Sale of Asset account in Posting Templates first." };
  }

  const { data: costCenter } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .select("id")
    .eq("asset_id", parsed.data.assetId)
    .maybeSingle();
  const costCenterId = costCenter?.id ?? null;

  const lines: EntryLineInput[] = [
    {
      accountId: receivableId,
      costCenterId,
      debit: parsed.data.salePrice,
      credit: 0,
      description: "Asset sale proceeds",
    },
  ];
  if (profitLoss < 0) {
    lines.push({
      accountId: lossId!,
      costCenterId,
      debit: -profitLoss,
      credit: 0,
      description: "Loss on sale of asset",
    });
  }
  lines.push({ accountId: fixedAssetId, costCenterId, debit: 0, credit: bookValue, description: "Asset disposed" });
  if (profitLoss > 0) {
    lines.push({
      accountId: gainId!,
      costCenterId,
      debit: 0,
      credit: profitLoss,
      description: "Gain on sale of asset",
    });
  }

  const saleId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "asset_sales",
    voucherId: saleId,
    entryDate: parsed.data.saleDate,
    currencyId: parsed.data.currencyId,
    narration: "Asset sale",
    createdBy,
    lines,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("assets").from("asset_sales").insert({
    id: saleId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    asset_id: parsed.data.assetId,
    buyer: parsed.data.buyer,
    sale_date: parsed.data.saleDate,
    sale_price: parsed.data.salePrice,
    book_value_at_sale: bookValue,
    purchase_value_at_sale: purchaseValue,
    currency_id: parsed.data.currencyId,
    exchange_rate: je.exchangeRate,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  revalidatePath("/sales");
  return { success: true, id: saleId };
}

export async function postAssetSale(id: string, journalEntryId: string) {
  await requirePermission("asset_sales", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "asset_sales", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { data: sale, error: updateError } = await supabase
    .schema("assets")
    .from("asset_sales")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id)
    .select("asset_id")
    .single();
  if (updateError || !sale) return { error: updateError?.message ?? "Failed to update voucher" };

  await supabase.schema("assets").from("assets").update({ status: "sold" }).eq("id", sale.asset_id);

  revalidatePath("/sales");
  revalidatePath(`/sales/${id}`);
  revalidatePath(`/assets/${sale.asset_id}`);
  return { success: true, voucherNo: result.voucherNo };
}
