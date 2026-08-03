"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { chequeReturnVoucherSchema, type ChequeReturnVoucherInput } from "./schemas";

/**
 * The reversal simply swaps the original PDC's two accounts for its full
 * amount, undoing the transaction exactly. A penalty is modeled as
 * partially re-applying the original liability/asset account (by the
 * penalty amount) against a user-chosen penalty account — see the
 * migration's design notes for why a full three-account model (bank
 * charges hitting cash directly) isn't implemented here.
 */
export async function createChequeReturnVoucher(input: ChequeReturnVoucherInput) {
  const parsed = chequeReturnVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("cheque_return_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const table = parsed.data.originalPdcType === "pdc_payment_voucher" ? "pdc_payment_vouchers" : "pdc_receipt_vouchers";
  const { data: original, error: originalError } = await supabase
    .schema("accounting")
    .from(table)
    .select("id, debit_account_id, credit_account_id, amount, currency_id, pdc_status")
    .eq("company_id", companyId)
    .eq("id", parsed.data.originalPdcId)
    .single();

  if (originalError || !original) return { error: "Original cheque not found" };
  if (original.pdc_status !== "pending") {
    return { error: `This cheque is already ${original.pdc_status}` };
  }

  const lines: EntryLineInput[] = [
    { accountId: original.credit_account_id, debit: original.amount, credit: 0, description: "Cheque return reversal" },
    { accountId: original.debit_account_id, debit: 0, credit: original.amount, description: "Cheque return reversal" },
  ];

  if (parsed.data.penaltyAmount > 0 && parsed.data.penaltyAccountId) {
    if (parsed.data.originalPdcType === "pdc_payment_voucher") {
      lines.push(
        { accountId: parsed.data.penaltyAccountId, debit: parsed.data.penaltyAmount, credit: 0, description: "Cheque return penalty" },
        { accountId: original.credit_account_id, debit: 0, credit: parsed.data.penaltyAmount, description: "Cheque return penalty" },
      );
    } else {
      lines.push(
        { accountId: original.debit_account_id, debit: parsed.data.penaltyAmount, credit: 0, description: "Cheque return penalty" },
        { accountId: parsed.data.penaltyAccountId, debit: 0, credit: parsed.data.penaltyAmount, description: "Cheque return penalty" },
      );
    }
  }

  const voucherId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "cheque_return_voucher",
    voucherId,
    entryDate: parsed.data.returnDate,
    currencyId: original.currency_id,
    narration: parsed.data.returnReason,
    createdBy,
    lines,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("cheque_return_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    original_pdc_type: parsed.data.originalPdcType,
    original_pdc_id: parsed.data.originalPdcId,
    return_date: parsed.data.returnDate,
    return_reason: parsed.data.returnReason,
    penalty_amount: parsed.data.penaltyAmount,
    penalty_account_id: parsed.data.penaltyAccountId || null,
    currency_id: original.currency_id,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/cheque_return_voucher");
  return { success: true, id: voucherId };
}

export async function postChequeReturnVoucher(id: string, journalEntryId: string) {
  await requirePermission("cheque_return_voucher", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "cheque_return_voucher", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { data: voucher, error: fetchError } = await supabase
    .schema("accounting")
    .from("cheque_return_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id)
    .select("original_pdc_type, original_pdc_id")
    .single();
  if (fetchError || !voucher) return { error: fetchError?.message ?? "Failed to update voucher" };

  const table = voucher.original_pdc_type === "pdc_payment_voucher" ? "pdc_payment_vouchers" : "pdc_receipt_vouchers";
  const { error: statusError } = await supabase
    .schema("accounting")
    .from(table)
    .update({ pdc_status: "returned" })
    .eq("id", voucher.original_pdc_id);
  if (statusError) return { error: statusError.message };

  revalidatePath("/accounting/vouchers/cheque_return_voucher");
  revalidatePath("/accounting/vouchers/pdc_payment_voucher");
  revalidatePath("/accounting/vouchers/pdc_receipt_voucher");
  return { success: true, voucherNo: result.voucherNo };
}
