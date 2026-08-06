"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { assetSaleSchema, type AssetSaleInput } from "./schemas";

export async function createAssetSale(input: AssetSaleInput) {
  const parsed = assetSaleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("asset_sales", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const assetId = parsed.data.assetId || null;
  const lines = parsed.data.lines;
  const total = lines.reduce((sum, l) => sum + l.gross, 0);
  if (total <= 0) return { error: "Total value must be greater than zero" };

  if (assetId) {
    const { data: asset } = await supabase
      .schema("assets")
      .from("assets")
      .select("status")
      .eq("id", assetId)
      .maybeSingle();
    if (asset?.status === "sold") return { error: "This asset has already been sold" };
  }

  // Cost center of the (optional) header asset, tagged onto the entry lines.
  let costCenterId: string | null = null;
  if (assetId) {
    const { data: costCenter } = await supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id")
      .eq("asset_id", assetId)
      .maybeSingle();
    costCenterId = costCenter?.id ?? null;
  }

  const saleId = crypto.randomUUID();

  // Debit the Customer (receivable) account for the total; credit each line's
  // Fixed Asset (Property) account for its gross.
  const jeLines: EntryLineInput[] = [
    {
      accountId: parsed.data.customerAccountId,
      costCenterId,
      debit: total,
      credit: 0,
      description: "Asset sale proceeds",
    },
    ...lines.map((l) => ({
      accountId: l.fixedAssetAccountId,
      costCenterId,
      debit: 0,
      credit: l.gross,
      description: "Asset disposed",
    })),
  ];

  const je = await createJournalEntry({
    companyId,
    voucherType: "asset_sales",
    voucherId: saleId,
    entryDate: parsed.data.saleDate,
    currencyId: parsed.data.currencyId,
    narration: parsed.data.narration || "Asset sale",
    createdBy,
    lines: jeLines,
    exchangeRate: parsed.data.exchangeRate,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("assets").from("asset_sales").insert({
    id: saleId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    asset_id: assetId,
    customer_account_id: parsed.data.customerAccountId,
    sale_date: parsed.data.saleDate,
    currency_id: parsed.data.currencyId,
    exchange_rate: je.exchangeRate,
    pak_exch: parsed.data.pakExch,
    narration: parsed.data.narration || null,
    total_value: total,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  const lineRows = lines.map((l, index) => ({
    sale_id: saleId,
    line_no: index + 1,
    fixed_asset_account_id: l.fixedAssetAccountId,
    gross: l.gross,
    remarks: l.remarks || null,
  }));
  const { error: linesError } = await supabase.schema("assets").from("asset_sale_lines").insert(lineRows);
  if (linesError) return { error: linesError.message };

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

  if (sale.asset_id) {
    await supabase.schema("assets").from("assets").update({ status: "sold" }).eq("id", sale.asset_id);
    revalidatePath(`/assets/${sale.asset_id}`);
  }

  revalidatePath("/sales");
  revalidatePath(`/sales/${id}`);
  return { success: true, voucherNo: result.voucherNo };
}
