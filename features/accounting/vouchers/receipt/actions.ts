"use server";

import { revalidatePath } from "next/cache";

import { isCurrentUserAdmin, requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { receiptVoucherSchema, type ReceiptVoucherInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// The journal-line description carries the line's rent month + remarks so they
// show on the (generic) voucher detail page.
function lineDescription(rentMonth?: string, remarks?: string) {
  const parts = [rentMonth || "", remarks || ""].filter(Boolean);
  return parts.length ? parts.join(" — ") : "Receipt";
}

export async function createReceiptVoucher(input: ReceiptVoucherInput, options?: { autoPostIfAdmin?: boolean }) {
  const parsed = receiptVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("receipt_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const lines = parsed.data.lines;
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  if (total <= 0) return { error: "Total must be greater than zero" };
  const costCenterId = parsed.data.costCenterId || null;
  const voucherId = crypto.randomUUID();

  // Debit the Cash/Bank account for the total; credit each line's account.
  const jeLines: EntryLineInput[] = [
    {
      accountId: parsed.data.debitAccountId,
      costCenterId,
      debit: total,
      credit: 0,
      description: "Receipt",
    },
    ...lines.map((l) => ({
      accountId: l.accountId,
      costCenterId,
      debit: 0,
      credit: l.amount,
      description: lineDescription(l.rentMonth, l.remarks),
    })),
  ];

  const je = await createJournalEntry({
    companyId,
    voucherType: "receipt_voucher",
    voucherId,
    entryDate: parsed.data.receiptDate,
    currencyId: parsed.data.currencyId,
    narration: parsed.data.narration || "Receipt",
    createdBy,
    lines: jeLines,
    exchangeRate: parsed.data.exchangeRate,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("receipt_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    receipt_date: parsed.data.receiptDate,
    due_date: null,
    debit_account_id: parsed.data.debitAccountId,
    cost_center_id: costCenterId,
    currency_id: parsed.data.currencyId,
    exchange_rate: je.exchangeRate,
    narration: parsed.data.narration || null,
    total_amount: total,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  const lineRows = lines.map((l, index) => ({
    voucher_id: voucherId,
    line_no: index + 1,
    account_id: l.accountId,
    amount: l.amount,
    rent_month: l.rentMonth || null,
    remarks: l.remarks || null,
    applied_country: l.invoiceId ? l.invoiceCountry || null : null,
    applied_uae_invoice_id: l.invoiceId && l.invoiceCountry === "UAE" ? l.invoiceId : null,
    applied_pk_invoice_id: l.invoiceId && l.invoiceCountry === "PK" ? l.invoiceId : null,
  }));
  const { error: linesError } = await supabase
    .schema("accounting")
    .from("receipt_voucher_lines")
    .insert(lineRows);
  if (linesError) return { error: linesError.message };

  revalidatePath("/accounting/vouchers/receipt_voucher");
  if (options?.autoPostIfAdmin !== false && (await isCurrentUserAdmin())) {
    try {
      await postReceiptVoucher(voucherId, je.journalEntryId);
    } catch {
      // Auto-post is best-effort; the created draft remains for manual posting.
    }
  }
  return { success: true, id: voucherId };
}

export async function updateReceiptVoucher(id: string, input: ReceiptVoucherInput) {
  const parsed = receiptVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("receipt_voucher", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: v } = await supabase
    .schema("accounting")
    .from("receipt_vouchers")
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
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  if (total <= 0) return { error: "Total must be greater than zero" };
  const rate = parsed.data.exchangeRate;
  const costCenterId = parsed.data.costCenterId || null;

  const { error: jeErr } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({
      entry_date: parsed.data.receiptDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || "Receipt",
    })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

  // Rebuild the journal lines: debit Cash/Bank for the total, credit each line.
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
      account_id: parsed.data.debitAccountId,
      cost_center_id: costCenterId,
      debit_amount: total,
      credit_amount: 0,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      base_debit_amount: round2(total * rate),
      base_credit_amount: 0,
      description: "Receipt",
    },
    ...lines.map((l, index) => ({
      journal_entry_id: jeId,
      line_no: index + 2,
      account_id: l.accountId,
      cost_center_id: costCenterId,
      debit_amount: 0,
      credit_amount: l.amount,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      base_debit_amount: 0,
      base_credit_amount: round2(l.amount * rate),
      description: lineDescription(l.rentMonth, l.remarks),
    })),
  ];
  const { error: insJe } = await supabase.schema("accounting").from("journal_entry_lines").insert(jeRows);
  if (insJe) return { error: insJe.message };

  // Rebuild the voucher's own lines (the write policy allows delete + insert for
  // a draft).
  const { error: delLines } = await supabase
    .schema("accounting")
    .from("receipt_voucher_lines")
    .delete()
    .eq("voucher_id", id);
  if (delLines) return { error: delLines.message };

  const lineRows = lines.map((l, index) => ({
    voucher_id: id,
    line_no: index + 1,
    account_id: l.accountId,
    amount: l.amount,
    rent_month: l.rentMonth || null,
    remarks: l.remarks || null,
    applied_country: l.invoiceId ? l.invoiceCountry || null : null,
    applied_uae_invoice_id: l.invoiceId && l.invoiceCountry === "UAE" ? l.invoiceId : null,
    applied_pk_invoice_id: l.invoiceId && l.invoiceCountry === "PK" ? l.invoiceId : null,
  }));
  const { error: insLines } = await supabase
    .schema("accounting")
    .from("receipt_voucher_lines")
    .insert(lineRows);
  if (insLines) return { error: insLines.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("receipt_vouchers")
    .update({
      receipt_date: parsed.data.receiptDate,
      due_date: null,
      debit_account_id: parsed.data.debitAccountId,
      cost_center_id: costCenterId,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || null,
      total_amount: total,
    })
    .eq("id", id);
  if (vErr) return { error: vErr.message };

  revalidatePath("/accounting/vouchers/receipt_voucher");
  revalidatePath(`/accounting/vouchers/receipt_voucher/${id}`);
  return { success: true, id };
}

export async function postReceiptVoucher(id: string, journalEntryId: string) {
  await requirePermission("receipt_voucher", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "receipt_voucher", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("receipt_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (error) return { error: error.message };

  // Apply any lines tagged with a rental invoice: writing an allocation row fires
  // the DB trigger that reduces the invoice's outstanding balance. Idempotent —
  // clears any prior allocations for this voucher first so a re-post can't double.
  await supabase.schema("rental").from("receipt_invoice_allocations").delete().eq("receipt_voucher_id", id);
  const { data: appliedLines } = await supabase
    .schema("accounting")
    .from("receipt_voucher_lines")
    .select("id, amount, applied_country, applied_uae_invoice_id, applied_pk_invoice_id")
    .eq("voucher_id", id)
    .not("applied_country", "is", null);
  const allocations = (appliedLines ?? [])
    .filter((l) => Number(l.amount) > 0 && (l.applied_uae_invoice_id || l.applied_pk_invoice_id))
    .map((l) => ({
      company_id: companyId,
      receipt_voucher_id: id,
      receipt_line_id: l.id as string,
      country: l.applied_country as string,
      uae_invoice_id: (l.applied_uae_invoice_id as string | null) ?? null,
      pk_invoice_id: (l.applied_pk_invoice_id as string | null) ?? null,
      amount: Number(l.amount),
    }));
  if (allocations.length) {
    await supabase.schema("rental").from("receipt_invoice_allocations").insert(allocations);
  }

  revalidatePath("/accounting/vouchers/receipt_voucher");
  return { success: true, voucherNo: result.voucherNo };
}
