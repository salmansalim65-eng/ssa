"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { formatMonth } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, EDITABLE_STATUSES, getCurrentCompanyId, postVoucher, resubmitEditedVoucher, routeNewVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { pdcReceiptVoucherSchema, type PdcReceiptVoucherInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function lineDescription(chequeNo: string, rentMonth?: string, remarks?: string) {
  const parts = [formatMonth(rentMonth), remarks || ""].filter(Boolean);
  return parts.length ? parts.join(" — ") : `PDC ${chequeNo}`;
}

// The control line and the fallback narration cover the whole voucher, so they
// name the cheques it holds rather than a single one.
function chequeSummary(lines: { chequeNo: string }[]) {
  const nos = [...new Set(lines.map((l) => l.chequeNo).filter(Boolean))];
  if (nos.length <= 3) return nos.join(", ");
  return `${nos.slice(0, 3).join(", ")} +${nos.length - 3} more`;
}

type PdcSupabase = Awaited<ReturnType<typeof createClient>>;
type PdcLine = PdcReceiptVoucherInput["lines"][number];

// Write the per-line bill adjustments into rental.receipt_invoice_allocations
// (whose trigger reduces each invoice's outstanding balance) — same table as
// the Receipt voucher, but owned by a PDC receipt. Returns an error message or
// null; no-op when no line has allocations.
async function writePdcReceiptAllocations(
  supabase: PdcSupabase,
  companyId: string,
  voucherId: string,
  lines: PdcLine[],
  insertedLines: { id: string; line_no: number }[],
) {
  const idByLineNo = new Map(insertedLines.map((l) => [l.line_no, l.id]));
  const rows = lines.flatMap((l, index) =>
    (l.allocations ?? []).map((a) => ({
      company_id: companyId,
      pdc_receipt_voucher_id: voucherId,
      pdc_receipt_line_id: idByLineNo.get(index + 1) ?? null,
      country: a.country,
      uae_invoice_id: a.country === "UAE" ? a.invoiceId : null,
      pk_invoice_id: a.country === "PK" ? a.invoiceId : null,
      amount: a.amount,
    })),
  );
  if (!rows.length) return null;
  const { error } = await supabase.schema("rental").from("receipt_invoice_allocations").insert(rows);
  return error ? error.message : null;
}

export async function createPdcReceiptVoucher(input: PdcReceiptVoucherInput, options?: { autoPostIfAdmin?: boolean }) {
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
      description: `PDC ${chequeSummary(lines)}`,
    },
    ...lines.map((l) => ({
      accountId: l.accountId,
      costCenterId,
      debit: 0,
      credit: l.amount,
      description: lineDescription(l.chequeNo, l.rentMonth, l.remarks),
    })),
  ];

  const je = await createJournalEntry({
    companyId,
    voucherType: "pdc_receipt_voucher",
    voucherId,
    entryDate: parsed.data.voucherDate,
    currencyId: parsed.data.currencyId,
    narration: parsed.data.narration || `PDC ${chequeSummary(lines)}`,
    createdBy,
    lines: jeLines,
    exchangeRate: parsed.data.exchangeRate,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("pdc_receipt_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    voucher_date: parsed.data.voucherDate,
    // The header's cheque columns mirror the FIRST line, so the voucher lists,
    // the Cheque Return picker and the reports reading them keep working.
    cheque_no: lines[0].chequeNo,
    cheque_date: lines[0].chequeDate,
    due_date: lines[0].dueDate || null,
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
    cheque_no: l.chequeNo,
    cheque_date: l.chequeDate,
    due_date: l.dueDate || null,
    amount: l.amount,
    rent_month: l.rentMonth || null,
    remarks: l.remarks || null,
  }));
  const { data: insertedLines, error: linesError } = await supabase
    .schema("accounting")
    .from("pdc_receipt_voucher_lines")
    .insert(lineRows)
    .select("id, line_no");
  if (linesError) return { error: linesError.message };

  const allocErr = await writePdcReceiptAllocations(supabase, companyId, voucherId, lines, insertedLines ?? []);
  if (allocErr) return { error: allocErr };

  revalidatePath("/accounting/vouchers/pdc_receipt_voucher");
  revalidatePath("/dashboard");
  // An admin's voucher posts on the spot; anyone else's goes straight to the
  // approver — no "Submit for approval" click in between.
  if (options?.autoPostIfAdmin !== false) {
    await routeNewVoucher({
      companyId,
      voucherType: "pdc_receipt_voucher",
      voucherId,
      journalEntryId: je.journalEntryId,
      post: () => postPdcReceiptVoucher(voucherId, je.journalEntryId),
    });
  }
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
  if (!EDITABLE_STATUSES.includes(je.status)) {
    return { error: "A posted voucher can no longer be edited" };
  }

  const lines = parsed.data.lines;
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  if (total <= 0) return { error: "Total must be greater than zero" };
  const rate = parsed.data.exchangeRate;
  const costCenterId = parsed.data.costCenterId || null;

  const { error: jeErr } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({
      entry_date: parsed.data.voucherDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || `PDC ${chequeSummary(lines)}`,
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
      description: `PDC ${chequeSummary(lines)}`,
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
      description: lineDescription(l.chequeNo, l.rentMonth, l.remarks),
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
    cheque_no: l.chequeNo,
    cheque_date: l.chequeDate,
    due_date: l.dueDate || null,
    amount: l.amount,
    rent_month: l.rentMonth || null,
    remarks: l.remarks || null,
  }));
  const { data: insertedLines, error: insLines } = await supabase
    .schema("accounting")
    .from("pdc_receipt_voucher_lines")
    .insert(lineRows)
    .select("id, line_no");
  if (insLines) return { error: insLines.message };

  // Deleting the old lines above cascaded their allocations away (restoring the
  // invoices' outstanding); write the new adjustments here.
  const allocErr = await writePdcReceiptAllocations(supabase, companyId, id, lines, insertedLines ?? []);
  if (allocErr) return { error: allocErr };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("pdc_receipt_vouchers")
    .update({
      voucher_date: parsed.data.voucherDate,
      // The header's cheque columns mirror the FIRST line, so the voucher lists,
      // the Cheque Return picker and the reports reading them keep working.
      cheque_no: lines[0].chequeNo,
      cheque_date: lines[0].chequeDate,
      due_date: lines[0].dueDate || null,
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

  // An edited voucher goes back to the approver: the workflow step is chosen by
  // amount, and a sent-back voucher is corrected precisely so it can return.
  await resubmitEditedVoucher({
    companyId,
    voucherType: "pdc_receipt_voucher",
    voucherId: id,
    journalEntryId: jeId,
    previousStatus: je.status,
  });

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
