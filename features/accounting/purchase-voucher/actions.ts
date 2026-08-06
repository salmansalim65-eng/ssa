"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { purchaseVoucherSchema, type PurchaseVoucherInput } from "./schemas";

export async function createPurchaseVoucher(input: PurchaseVoucherInput) {
  const parsed = purchaseVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("purchase_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const lines = parsed.data.lines;
  const total = lines.reduce((sum, l) => sum + l.gross, 0);
  if (total <= 0) return { error: "Total value must be greater than zero" };

  // Cost center for each line's asset (auto-created per asset), so the debit
  // lines carry the property they belong to.
  const { data: costCenters } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .select("id, asset_id")
    .in(
      "asset_id",
      lines.map((l) => l.assetId),
    );
  const costCenterByAsset = new Map((costCenters ?? []).map((c) => [c.asset_id, c.id]));

  const voucherId = crypto.randomUUID();

  // Debit each line's Fixed Asset account; credit the Vendor (payable) account
  // for the total.
  const jeLines: EntryLineInput[] = [
    ...lines.map((l) => ({
      accountId: l.fixedAssetAccountId,
      costCenterId: costCenterByAsset.get(l.assetId) ?? null,
      debit: l.gross,
      credit: 0,
      description: "Property purchase",
    })),
    { accountId: parsed.data.vendorAccountId, debit: 0, credit: total, description: "Property purchase" },
  ];

  const je = await createJournalEntry({
    companyId,
    voucherType: "purchase_voucher",
    voucherId,
    entryDate: parsed.data.purchaseDate,
    currencyId: parsed.data.currencyId,
    narration: parsed.data.narration || "Property purchase",
    createdBy,
    lines: jeLines,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("purchase_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    supplier_id: parsed.data.supplierId,
    vendor_account_id: parsed.data.vendorAccountId,
    purchase_date: parsed.data.purchaseDate,
    currency_id: parsed.data.currencyId,
    exchange_rate: je.exchangeRate,
    narration: parsed.data.narration || null,
    payment_terms: parsed.data.paymentTerms || null,
    share_percentage: parsed.data.sharePercentage,
    total_value: total,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  const lineRows = lines.map((l, index) => ({
    voucher_id: voucherId,
    line_no: index + 1,
    asset_id: l.assetId,
    fixed_asset_account_id: l.fixedAssetAccountId,
    gross: l.gross,
    due_date: l.dueDate || null,
    installment_month: l.installmentMonth || null,
    remarks: l.remarks || null,
  }));
  const { error: linesError } = await supabase
    .schema("accounting")
    .from("purchase_voucher_lines")
    .insert(lineRows);
  if (linesError) return { error: linesError.message };

  revalidatePath("/purchases");
  return { success: true, id: voucherId };
}

export async function postPurchaseVoucher(id: string, journalEntryId: string) {
  await requirePermission("purchase_voucher", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "purchase_voucher", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error: updateError } = await supabase
    .schema("accounting")
    .from("purchase_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (updateError) return { error: updateError.message };

  // Record each purchased asset's value from its line's gross amount.
  const { data: lines } = await supabase
    .schema("accounting")
    .from("purchase_voucher_lines")
    .select("asset_id, gross")
    .eq("voucher_id", id);

  for (const line of lines ?? []) {
    await supabase
      .schema("assets")
      .from("assets")
      .update({ purchase_value: line.gross, current_value: line.gross })
      .eq("id", line.asset_id);
    revalidatePath(`/assets/${line.asset_id}`);
  }

  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
  return { success: true, voucherNo: result.voucherNo };
}
