"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher } from "@/lib/vouchers/engine";
import { receiptVoucherSchema, type ReceiptVoucherInput } from "./schemas";

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
