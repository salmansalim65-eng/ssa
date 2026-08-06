"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, resolveExchangeRate } from "@/lib/vouchers/engine";
import { pdcPaymentVoucherSchema, type PdcPaymentVoucherInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function createPdcPaymentVoucher(input: PdcPaymentVoucherInput) {
  const parsed = pdcPaymentVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("pdc_payment_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;
  const voucherId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "pdc_payment_voucher",
    voucherId,
    entryDate: parsed.data.chequeDate,
    currencyId: parsed.data.currencyId,
    narration: parsed.data.narration || null,
    createdBy,
    lines: [
      { accountId: parsed.data.debitAccountId, debit: parsed.data.amount, credit: 0, description: `PDC ${parsed.data.chequeNo}` },
      { accountId: parsed.data.creditAccountId, debit: 0, credit: parsed.data.amount, description: `PDC ${parsed.data.chequeNo}` },
    ],
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("pdc_payment_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    cheque_no: parsed.data.chequeNo,
    cheque_date: parsed.data.chequeDate,
    payee: parsed.data.payee,
    debit_account_id: parsed.data.debitAccountId,
    credit_account_id: parsed.data.creditAccountId,
    currency_id: parsed.data.currencyId,
    amount: parsed.data.amount,
    narration: parsed.data.narration || null,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/pdc_payment_voucher");
  return { success: true, id: voucherId };
}

export async function updatePdcPaymentVoucher(id: string, input: PdcPaymentVoucherInput) {
  const parsed = pdcPaymentVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("pdc_payment_voucher", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: v } = await supabase
    .schema("accounting")
    .from("pdc_payment_vouchers")
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

  const exchangeRate = await resolveExchangeRate(companyId, parsed.data.currencyId, parsed.data.chequeDate);
  const amount = parsed.data.amount;
  const base = round2(amount * exchangeRate);
  const desc = `PDC ${parsed.data.chequeNo}`;

  const { error: jeErr } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({
      entry_date: parsed.data.chequeDate,
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
      description: desc,
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
      description: desc,
    })
    .eq("journal_entry_id", jeId)
    .eq("line_no", 2);
  if (l2) return { error: l2.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("pdc_payment_vouchers")
    .update({
      cheque_no: parsed.data.chequeNo,
      cheque_date: parsed.data.chequeDate,
      payee: parsed.data.payee,
      debit_account_id: parsed.data.debitAccountId,
      credit_account_id: parsed.data.creditAccountId,
      currency_id: parsed.data.currencyId,
      amount,
      narration: parsed.data.narration || null,
    })
    .eq("id", id);
  if (vErr) return { error: vErr.message };

  revalidatePath("/accounting/vouchers/pdc_payment_voucher");
  revalidatePath(`/accounting/vouchers/pdc_payment_voucher/${id}`);
  return { success: true, id };
}

export async function postPdcPaymentVoucher(id: string, journalEntryId: string) {
  await requirePermission("pdc_payment_voucher", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "pdc_payment_voucher", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("pdc_payment_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/pdc_payment_voucher");
  return { success: true, voucherNo: result.voucherNo };
}

// 'returned' is deliberately not settable here — recording a bounced
// cheque goes through the Cheque Return Voucher, which posts the
// reversing entry and flips this status as part of the same action.
export async function setPdcPaymentStatus(id: string, status: "cleared" | "cancelled") {
  await requirePermission("pdc_payment_voucher", "edit");

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("pdc_payment_vouchers")
    .update({ pdc_status: status })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/pdc_payment_voucher");
  return { success: true };
}
