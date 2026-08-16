"use server";

import { revalidatePath } from "next/cache";

import { isCurrentUserAdmin, requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { paymentVoucherSchema, type PaymentVoucherInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function lineDescription(remarks?: string) {
  const parts = [remarks || ""].filter(Boolean);
  return parts.length ? parts.join(" — ") : "Payment";
}

export async function createPaymentVoucher(input: PaymentVoucherInput, options?: { autoPostIfAdmin?: boolean }) {
  const parsed = paymentVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("payment_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const lines = parsed.data.lines;
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  if (total <= 0) return { error: "Total must be greater than zero" };
  const costCenterId = parsed.data.costCenterId || null;
  const voucherId = crypto.randomUUID();

  // Debit each line's account; credit the Cash/Bank account for the total.
  const jeLines: EntryLineInput[] = [
    ...lines.map((l) => ({
      accountId: l.accountId,
      costCenterId,
      debit: l.amount,
      credit: 0,
      description: lineDescription(l.remarks),
    })),
    {
      accountId: parsed.data.creditAccountId,
      costCenterId,
      debit: 0,
      credit: total,
      description: "Payment",
    },
  ];

  const je = await createJournalEntry({
    companyId,
    voucherType: "payment_voucher",
    voucherId,
    entryDate: parsed.data.paymentDate,
    currencyId: parsed.data.currencyId,
    narration: parsed.data.narration || "Payment",
    createdBy,
    lines: jeLines,
    exchangeRate: parsed.data.exchangeRate,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("payment_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    payment_date: parsed.data.paymentDate,
    credit_account_id: parsed.data.creditAccountId,
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
    remarks: l.remarks || null,
    applied_country: l.invoiceId ? l.invoiceCountry || null : null,
    applied_uae_invoice_id: l.invoiceId && l.invoiceCountry === "UAE" ? l.invoiceId : null,
    applied_pk_invoice_id: l.invoiceId && l.invoiceCountry === "PK" ? l.invoiceId : null,
  }));
  const { error: linesError } = await supabase
    .schema("accounting")
    .from("payment_voucher_lines")
    .insert(lineRows);
  if (linesError) return { error: linesError.message };

  revalidatePath("/accounting/vouchers/payment_voucher");
  if (options?.autoPostIfAdmin !== false && (await isCurrentUserAdmin())) {
    try {
      await postPaymentVoucher(voucherId, je.journalEntryId);
    } catch {
      // Auto-post is best-effort; the created draft remains for manual posting.
    }
  }
  return { success: true, id: voucherId };
}

export async function updatePaymentVoucher(id: string, input: PaymentVoucherInput) {
  const parsed = paymentVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("payment_voucher", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: v } = await supabase
    .schema("accounting")
    .from("payment_vouchers")
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
      entry_date: parsed.data.paymentDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || "Payment",
    })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

  // Rebuild the journal lines: debit each line, credit Cash/Bank for the total.
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
      account_id: l.accountId,
      cost_center_id: costCenterId,
      debit_amount: l.amount,
      credit_amount: 0,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      base_debit_amount: round2(l.amount * rate),
      base_credit_amount: 0,
      description: lineDescription(l.remarks),
    })),
    {
      journal_entry_id: jeId,
      line_no: lines.length + 1,
      account_id: parsed.data.creditAccountId,
      cost_center_id: costCenterId,
      debit_amount: 0,
      credit_amount: total,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      base_debit_amount: 0,
      base_credit_amount: round2(total * rate),
      description: "Payment",
    },
  ];
  const { error: insJe } = await supabase.schema("accounting").from("journal_entry_lines").insert(jeRows);
  if (insJe) return { error: insJe.message };

  const { error: delLines } = await supabase
    .schema("accounting")
    .from("payment_voucher_lines")
    .delete()
    .eq("voucher_id", id);
  if (delLines) return { error: delLines.message };

  const lineRows = lines.map((l, index) => ({
    voucher_id: id,
    line_no: index + 1,
    account_id: l.accountId,
    amount: l.amount,
    remarks: l.remarks || null,
    applied_country: l.invoiceId ? l.invoiceCountry || null : null,
    applied_uae_invoice_id: l.invoiceId && l.invoiceCountry === "UAE" ? l.invoiceId : null,
    applied_pk_invoice_id: l.invoiceId && l.invoiceCountry === "PK" ? l.invoiceId : null,
  }));
  const { error: insLines } = await supabase
    .schema("accounting")
    .from("payment_voucher_lines")
    .insert(lineRows);
  if (insLines) return { error: insLines.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("payment_vouchers")
    .update({
      payment_date: parsed.data.paymentDate,
      credit_account_id: parsed.data.creditAccountId,
      cost_center_id: costCenterId,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || null,
      total_amount: total,
    })
    .eq("id", id);
  if (vErr) return { error: vErr.message };

  revalidatePath("/accounting/vouchers/payment_voucher");
  revalidatePath(`/accounting/vouchers/payment_voucher/${id}`);
  return { success: true, id };
}

export async function postPaymentVoucher(id: string, journalEntryId: string) {
  await requirePermission("payment_voucher", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "payment_voucher", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("payment_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (error) return { error: error.message };

  // Record any lines tagged with a rental invoice as an "other expense" on that
  // invoice (reduces the owner's balance rent in the Rent Balance report).
  // Idempotent — clears prior expenses for this voucher first.
  await supabase.schema("rental").from("payment_invoice_expenses").delete().eq("payment_voucher_id", id);
  const { data: appliedLines } = await supabase
    .schema("accounting")
    .from("payment_voucher_lines")
    .select("id, amount, applied_country, applied_uae_invoice_id, applied_pk_invoice_id")
    .eq("voucher_id", id)
    .not("applied_country", "is", null);
  const expenses = (appliedLines ?? [])
    .filter((l) => Number(l.amount) > 0 && (l.applied_uae_invoice_id || l.applied_pk_invoice_id))
    .map((l) => ({
      company_id: companyId,
      payment_voucher_id: id,
      payment_line_id: l.id as string,
      country: l.applied_country as string,
      uae_invoice_id: (l.applied_uae_invoice_id as string | null) ?? null,
      pk_invoice_id: (l.applied_pk_invoice_id as string | null) ?? null,
      amount: Number(l.amount),
    }));
  if (expenses.length) {
    await supabase.schema("rental").from("payment_invoice_expenses").insert(expenses);
  }

  revalidatePath("/accounting/vouchers/payment_voucher");
  return { success: true, voucherNo: result.voucherNo };
}
