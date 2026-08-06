"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, resolveExchangeRate } from "@/lib/vouchers/engine";
import { receiptVoucherSchema, type ReceiptVoucherInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function createReceiptVoucher(input: ReceiptVoucherInput) {
  const parsed = receiptVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("receipt_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;
  const voucherId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "receipt_voucher",
    voucherId,
    entryDate: parsed.data.receiptDate,
    currencyId: parsed.data.currencyId,
    narration: parsed.data.narration || null,
    createdBy,
    lines: [
      { accountId: parsed.data.debitAccountId, debit: parsed.data.amount, credit: 0, description: "Receipt" },
      { accountId: parsed.data.creditAccountId, debit: 0, credit: parsed.data.amount, description: "Receipt" },
    ],
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("receipt_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    receipt_date: parsed.data.receiptDate,
    received_from: parsed.data.receivedFrom,
    debit_account_id: parsed.data.debitAccountId,
    credit_account_id: parsed.data.creditAccountId,
    currency_id: parsed.data.currencyId,
    amount: parsed.data.amount,
    narration: parsed.data.narration || null,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

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

  // Receipt vouchers always have exactly two lines (line 1 = debit, line 2 =
  // credit), so we update them in place — no delete/insert, no imbalance window.
  const exchangeRate = await resolveExchangeRate(companyId, parsed.data.currencyId, parsed.data.receiptDate);
  const amount = parsed.data.amount;
  const base = round2(amount * exchangeRate);

  const { error: jeErr } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({
      entry_date: parsed.data.receiptDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: exchangeRate,
      narration: parsed.data.narration || null,
    })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

  const { error: l1 } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .update({
      account_id: parsed.data.debitAccountId,
      debit_amount: amount,
      credit_amount: 0,
      currency_id: parsed.data.currencyId,
      exchange_rate: exchangeRate,
      base_debit_amount: base,
      base_credit_amount: 0,
      description: "Receipt",
    })
    .eq("journal_entry_id", jeId)
    .eq("line_no", 1);
  if (l1) return { error: l1.message };

  const { error: l2 } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .update({
      account_id: parsed.data.creditAccountId,
      debit_amount: 0,
      credit_amount: amount,
      currency_id: parsed.data.currencyId,
      exchange_rate: exchangeRate,
      base_debit_amount: 0,
      base_credit_amount: base,
      description: "Receipt",
    })
    .eq("journal_entry_id", jeId)
    .eq("line_no", 2);
  if (l2) return { error: l2.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("receipt_vouchers")
    .update({
      receipt_date: parsed.data.receiptDate,
      received_from: parsed.data.receivedFrom,
      debit_account_id: parsed.data.debitAccountId,
      credit_account_id: parsed.data.creditAccountId,
      currency_id: parsed.data.currencyId,
      amount,
      narration: parsed.data.narration || null,
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
