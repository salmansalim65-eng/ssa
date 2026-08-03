"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher } from "@/lib/vouchers/engine";
import { pdcReceiptVoucherSchema, type PdcReceiptVoucherInput } from "./schemas";

export async function createPdcReceiptVoucher(input: PdcReceiptVoucherInput) {
  const parsed = pdcReceiptVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("pdc_receipt_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;
  const voucherId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "pdc_receipt_voucher",
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

  const { error } = await supabase.schema("accounting").from("pdc_receipt_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    cheque_no: parsed.data.chequeNo,
    cheque_date: parsed.data.chequeDate,
    payer: parsed.data.payer,
    debit_account_id: parsed.data.debitAccountId,
    credit_account_id: parsed.data.creditAccountId,
    currency_id: parsed.data.currencyId,
    amount: parsed.data.amount,
    narration: parsed.data.narration || null,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/pdc_receipt_voucher");
  return { success: true, id: voucherId };
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
