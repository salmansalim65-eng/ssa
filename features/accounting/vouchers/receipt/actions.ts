"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
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

export async function createReceiptVoucher(input: ReceiptVoucherInput) {
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
    due_date: parsed.data.dueDate || null,
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
  }));
  const { error: linesError } = await supabase
    .schema("accounting")
    .from("receipt_voucher_lines")
    .insert(lineRows);
  if (linesError) return { error: linesError.message };

  revalidatePath("/accounting/vouchers/receipt_voucher");
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
      due_date: parsed.data.dueDate || null,
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

  revalidatePath("/accounting/vouchers/receipt_voucher");
  return { success: true, voucherNo: result.voucherNo };
}
