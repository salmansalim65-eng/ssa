"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { purchaseVoucherSchema, type PurchaseVoucherInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

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

  const voucherId = crypto.randomUUID();

  // Debit each line's Fixed Asset account; credit the Vendor (payable) account
  // for the total.
  const jeLines: EntryLineInput[] = [
    ...lines.map((l) => ({
      accountId: l.fixedAssetAccountId,
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
    exchangeRate: parsed.data.exchangeRate,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("purchase_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
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

export async function updatePurchaseVoucher(id: string, input: PurchaseVoucherInput) {
  const parsed = purchaseVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("purchase_voucher", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: v } = await supabase
    .schema("accounting")
    .from("purchase_vouchers")
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
      entry_date: parsed.data.purchaseDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || "Property purchase",
    })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

  // Rebuild the journal lines: debit each Fixed Asset account for its gross,
  // credit the Vendor account for the total.
  const { error: delJe } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .delete()
    .eq("journal_entry_id", jeId);
  if (delJe) return { error: delJe.message };

  const jeRows = [
    ...lines.map((l, index) => ({
      journal_entry_id: jeId,
      line_no: index + 1,
      account_id: l.fixedAssetAccountId,
      cost_center_id: null,
      debit_amount: l.gross,
      credit_amount: 0,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      base_debit_amount: round2(l.gross * rate),
      base_credit_amount: 0,
      description: "Property purchase",
    })),
    {
      journal_entry_id: jeId,
      line_no: lines.length + 1,
      account_id: parsed.data.vendorAccountId,
      cost_center_id: null,
      debit_amount: 0,
      credit_amount: total,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      base_debit_amount: 0,
      base_credit_amount: round2(total * rate),
      description: "Property purchase",
    },
  ];
  const { error: insJe } = await supabase.schema("accounting").from("journal_entry_lines").insert(jeRows);
  if (insJe) return { error: insJe.message };

  // Rebuild the voucher's asset lines. purchase_voucher_lines has no row-level
  // DELETE policy, so a definer clears the old lines (draft-guarded) before we
  // re-insert through the INSERT policy.
  const { error: delLines } = await supabase
    .schema("accounting")
    .rpc("fn_clear_purchase_voucher_lines", { p_voucher_id: id });
  if (delLines) return { error: delLines.message };

  const lineRows = lines.map((l, index) => ({
    voucher_id: id,
    line_no: index + 1,
    fixed_asset_account_id: l.fixedAssetAccountId,
    gross: l.gross,
    due_date: l.dueDate || null,
    installment_month: l.installmentMonth || null,
    remarks: l.remarks || null,
  }));
  const { error: insLines } = await supabase
    .schema("accounting")
    .from("purchase_voucher_lines")
    .insert(lineRows);
  if (insLines) return { error: insLines.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("purchase_vouchers")
    .update({
      vendor_account_id: parsed.data.vendorAccountId,
      purchase_date: parsed.data.purchaseDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || null,
      payment_terms: parsed.data.paymentTerms || null,
      share_percentage: parsed.data.sharePercentage,
      total_value: total,
    })
    .eq("id", id);
  if (vErr) return { error: vErr.message };

  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
  return { success: true, id };
}

export async function copyPurchaseVoucher(id: string) {
  await requirePermission("purchase_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  // Read the source header + lines, then re-create a fresh draft (dated today)
  // by reusing the normal create flow — the copy is never linked to the
  // original and always starts unposted.
  const { data: src } = await supabase
    .schema("accounting")
    .from("purchase_vouchers")
    .select("vendor_account_id, currency_id, exchange_rate, narration, payment_terms, share_percentage")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!src) return { error: "Purchase voucher not found" };

  const { data: lines } = await supabase
    .schema("accounting")
    .from("purchase_voucher_lines")
    .select("fixed_asset_account_id, gross, due_date, installment_month, remarks")
    .eq("voucher_id", id)
    .order("line_no");

  return createPurchaseVoucher({
    vendorAccountId: src.vendor_account_id ?? "",
    purchaseDate: new Date().toISOString().slice(0, 10),
    currencyId: src.currency_id,
    exchangeRate: src.exchange_rate,
    narration: src.narration ?? "",
    paymentTerms: src.payment_terms ?? "",
    sharePercentage: src.share_percentage ?? 0,
    lines: (lines ?? []).map((l) => ({
      fixedAssetAccountId: l.fixed_asset_account_id,
      gross: l.gross,
      dueDate: l.due_date ?? "",
      installmentMonth: l.installment_month ?? "",
      remarks: l.remarks ?? "",
    })),
  });
}

export async function deletePurchaseVoucher(id: string) {
  await requirePermission("purchase_voucher", "delete");
  const supabase = await createClient();
  // Definer function removes the draft voucher, its lines and its journal
  // entry; it refuses anything already posted.
  const { error } = await supabase.schema("accounting").rpc("fn_delete_draft_purchase_voucher", { p_id: id });
  if (error) return { error: error.message };

  revalidatePath("/purchases");
  return { success: true };
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

  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
  return { success: true, voucherNo: result.voucherNo };
}
