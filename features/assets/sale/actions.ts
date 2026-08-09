"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { assetSaleSchema, type AssetSaleInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

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
      costCenterId: l.costCenterId || costCenterId,
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
    payment_terms: parsed.data.paymentTerms || null,
    due_date: parsed.data.dueDate || null,
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
    cost_center_id: l.costCenterId || null,
    fixed_asset_account_id: l.fixedAssetAccountId,
    gross: l.gross,
    remarks: l.remarks || null,
  }));
  const { error: linesError } = await supabase.schema("assets").from("asset_sale_lines").insert(lineRows);
  if (linesError) return { error: linesError.message };

  revalidatePath("/sales");
  return { success: true, id: saleId };
}

export async function updateAssetSale(id: string, input: AssetSaleInput) {
  const parsed = assetSaleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("asset_sales", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: v } = await supabase
    .schema("assets")
    .from("asset_sales")
    .select("journal_entry_id")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!v) return { error: "Voucher not found" };

  const jeId = v.journal_entry_id;
  const { data: je } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .select("status")
    .eq("id", jeId)
    .single();
  if (!je) return { error: "Voucher not found" };
  if (je.status !== "draft") return { error: "Only draft vouchers can be edited" };

  const lines = parsed.data.lines;
  const total = lines.reduce((sum, l) => sum + l.gross, 0);
  if (total <= 0) return { error: "Total value must be greater than zero" };
  const rate = parsed.data.exchangeRate;

  const { error: jeErr } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({
      entry_date: parsed.data.saleDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || "Asset sale",
    })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

  // Rebuild the journal lines: debit the Customer account for the total, credit
  // each Fixed Asset (Property) account for its gross.
  const { error: delJe } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .delete()
    .eq("journal_entry_id", jeId);
  if (delJe) return { error: delJe.message };

  const jeRows = [
    {
      journal_entry_id: jeId,
      line_no: 1,
      account_id: parsed.data.customerAccountId,
      cost_center_id: null,
      debit_amount: total,
      credit_amount: 0,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      base_debit_amount: round2(total * rate),
      base_credit_amount: 0,
      description: "Asset sale proceeds",
    },
    ...lines.map((l, index) => ({
      journal_entry_id: jeId,
      line_no: index + 2,
      account_id: l.fixedAssetAccountId,
      cost_center_id: l.costCenterId || null,
      debit_amount: 0,
      credit_amount: l.gross,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      base_debit_amount: 0,
      base_credit_amount: round2(l.gross * rate),
      description: "Asset disposed",
    })),
  ];
  const { error: insJe } = await supabase.schema("accounting").from("journal_entry_lines").insert(jeRows);
  if (insJe) return { error: insJe.message };

  // Rebuild the sold-property lines. asset_sale_lines has no row-level DELETE
  // policy, so a definer clears the old lines (draft-guarded) before we
  // re-insert through the INSERT policy.
  const { error: delLines } = await supabase
    .schema("assets")
    .rpc("fn_clear_asset_sale_lines", { p_sale_id: id });
  if (delLines) return { error: delLines.message };

  const lineRows = lines.map((l, index) => ({
    sale_id: id,
    line_no: index + 1,
    cost_center_id: l.costCenterId || null,
    fixed_asset_account_id: l.fixedAssetAccountId,
    gross: l.gross,
    remarks: l.remarks || null,
  }));
  const { error: insLines } = await supabase.schema("assets").from("asset_sale_lines").insert(lineRows);
  if (insLines) return { error: insLines.message };

  const { error: vErr } = await supabase
    .schema("assets")
    .from("asset_sales")
    .update({
      customer_account_id: parsed.data.customerAccountId,
      sale_date: parsed.data.saleDate,
      payment_terms: parsed.data.paymentTerms || null,
      due_date: parsed.data.dueDate || null,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      pak_exch: parsed.data.pakExch,
      narration: parsed.data.narration || null,
      total_value: total,
    })
    .eq("id", id);
  if (vErr) return { error: vErr.message };

  revalidatePath("/sales");
  revalidatePath(`/sales/${id}`);
  return { success: true, id };
}

export async function copyAssetSale(id: string) {
  await requirePermission("asset_sales", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  // Read the source header + lines, then re-create a fresh draft (dated today)
  // by reusing the normal create flow. The optional header asset isn't copied —
  // new sales are account-driven — so the copy never re-marks an asset sold.
  const { data: src } = await supabase
    .schema("assets")
    .from("asset_sales")
    .select("customer_account_id, currency_id, exchange_rate, pak_exch, narration, payment_terms, due_date")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!src) return { error: "Sale asset voucher not found" };

  const { data: lines } = await supabase
    .schema("assets")
    .from("asset_sale_lines")
    .select("cost_center_id, fixed_asset_account_id, gross, remarks")
    .eq("sale_id", id)
    .order("line_no");

  return createAssetSale({
    customerAccountId: src.customer_account_id ?? "",
    saleDate: new Date().toISOString().slice(0, 10),
    paymentTerms: src.payment_terms ?? "",
    dueDate: src.due_date ?? "",
    currencyId: src.currency_id,
    exchangeRate: src.exchange_rate,
    pakExch: src.pak_exch ?? 0,
    narration: src.narration ?? "",
    lines: (lines ?? []).map((l) => ({
      costCenterId: l.cost_center_id ?? "",
      fixedAssetAccountId: l.fixed_asset_account_id,
      gross: l.gross,
      remarks: l.remarks ?? "",
    })),
  });
}

export async function deleteAssetSale(id: string) {
  await requirePermission("asset_sales", "delete");
  const supabase = await createClient();
  // Definer function removes the draft voucher, its lines and its journal
  // entry; it refuses anything already posted.
  const { error } = await supabase.schema("assets").rpc("fn_delete_draft_asset_sale", { p_id: id });
  if (error) return { error: error.message };

  revalidatePath("/sales");
  return { success: true };
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
