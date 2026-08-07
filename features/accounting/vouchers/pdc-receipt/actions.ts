"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { pdcReceiptVoucherSchema, type PdcReceiptVoucherInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function lineDescription(chequeNo: string, rentMonth?: string, remarks?: string) {
  const parts = [rentMonth || "", remarks || ""].filter(Boolean);
  return parts.length ? parts.join(" — ") : `PDC ${chequeNo}`;
}

export async function createPdcReceiptVoucher(input: PdcReceiptVoucherInput) {
  const parsed = pdcReceiptVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("pdc_receipt_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const lines = parsed.data.lines;
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  if (total <= 0) return { error: "Total must be greater than zero" };
  const costCenterId = parsed.data.costCenterId || null;
  const voucherId = crypto.randomUUID();

  // Debit the PDC asset account for the total; credit each line's account.
  const jeLines: EntryLineInput[] = [
    {
      accountId: parsed.data.debitAccountId,
      costCenterId,
      debit: total,
      credit: 0,
      description: `PDC ${parsed.data.chequeNo}`,
    },
    ...lines.map((l) => ({
      accountId: l.accountId,
      costCenterId,
      debit: 0,
      credit: l.amount,
      description: lineDescription(parsed.data.chequeNo, l.rentMonth, l.remarks),
    })),
  ];

  const je = await createJournalEntry({
    companyId,
    voucherType: "pdc_receipt_voucher",
    voucherId,
    entryDate: parsed.data.chequeDate,
    currencyId: parsed.data.currencyId,
    narration: parsed.data.narration || `PDC ${parsed.data.chequeNo}`,
    createdBy,
    lines: jeLines,
    exchangeRate: parsed.data.exchangeRate,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("pdc_receipt_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    cheque_no: parsed.data.chequeNo,
    cheque_date: parsed.data.chequeDate,
    due_date: parsed.data.dueDate || null,
    payer: parsed.data.payer,
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
    .from("pdc_receipt_voucher_lines")
    .insert(lineRows);
  if (linesError) return { error: linesError.message };

  revalidatePath("/accounting/vouchers/pdc_receipt_voucher");
  return { success: true, id: voucherId };
}

export async function updatePdcReceiptVoucher(id: string, input: PdcReceiptVoucherInput) {
  const parsed = pdcReceiptVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("pdc_receipt_voucher", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: v } = await supabase
    .schema("accounting")
    .from("pdc_receipt_vouchers")
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
      entry_date: parsed.data.chequeDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || `PDC ${parsed.data.chequeNo}`,
    })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

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
      description: `PDC ${parsed.data.chequeNo}`,
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
      description: lineDescription(parsed.data.chequeNo, l.rentMonth, l.remarks),
    })),
  ];
  const { error: insJe } = await supabase.schema("accounting").from("journal_entry_lines").insert(jeRows);
  if (insJe) return { error: insJe.message };

  const { error: delLines } = await supabase
    .schema("accounting")
    .from("pdc_receipt_voucher_lines")
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
    .from("pdc_receipt_voucher_lines")
    .insert(lineRows);
  if (insLines) return { error: insLines.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("pdc_receipt_vouchers")
    .update({
      cheque_no: parsed.data.chequeNo,
      cheque_date: parsed.data.chequeDate,
      due_date: parsed.data.dueDate || null,
      payer: parsed.data.payer,
      debit_account_id: parsed.data.debitAccountId,
      cost_center_id: costCenterId,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || null,
      total_amount: total,
    })
    .eq("id", id);
  if (vErr) return { error: vErr.message };

  revalidatePath("/accounting/vouchers/pdc_receipt_voucher");
  revalidatePath(`/accounting/vouchers/pdc_receipt_voucher/${id}`);
  return { success: true, id };
}

export async function postPdcReceiptVoucher(id: string, journalEntryId: string) {
  await requirePermission("pdc_receipt_voucher", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "pdc_receipt_voucher", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("pdc_receipt_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/pdc_receipt_voucher");
  return { success: true, voucherNo: result.voucherNo };
}

export async function setPdcReceiptStatus(id: string, status: "cleared" | "cancelled") {
  await requirePermission("pdc_receipt_voucher", "edit");

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("pdc_receipt_vouchers")
    .update({ pdc_status: status })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/pdc_receipt_voucher");
  return { success: true };
}
