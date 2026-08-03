"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher } from "@/lib/vouchers/engine";
import { openingBalanceVoucherSchema, type OpeningBalanceVoucherInput } from "./schemas";

export async function createOpeningBalanceVoucher(input: OpeningBalanceVoucherInput) {
  const parsed = openingBalanceVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("opening_balance_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;
  const voucherId = crypto.randomUUID();

  const amount = parsed.data.debitAmount > 0 ? parsed.data.debitAmount : parsed.data.creditAmount;
  const lines =
    parsed.data.debitAmount > 0
      ? [
          { accountId: parsed.data.accountId, debit: amount, credit: 0, description: "Opening balance" },
          { accountId: parsed.data.contraAccountId, debit: 0, credit: amount, description: "Opening balance" },
        ]
      : [
          { accountId: parsed.data.contraAccountId, debit: amount, credit: 0, description: "Opening balance" },
          { accountId: parsed.data.accountId, debit: 0, credit: amount, description: "Opening balance" },
        ];

  const je = await createJournalEntry({
    companyId,
    voucherType: "opening_balance_voucher",
    voucherId,
    entryDate: parsed.data.asOfDate,
    currencyId: parsed.data.currencyId,
    narration: "Opening balance",
    createdBy,
    lines,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("opening_balance_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    as_of_date: parsed.data.asOfDate,
    account_id: parsed.data.accountId,
    contra_account_id: parsed.data.contraAccountId,
    currency_id: parsed.data.currencyId,
    debit_amount: parsed.data.debitAmount,
    credit_amount: parsed.data.creditAmount,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/opening_balance_voucher");
  return { success: true, id: voucherId };
}

export async function postOpeningBalanceVoucher(id: string, journalEntryId: string) {
  await requirePermission("opening_balance_voucher", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "opening_balance_voucher", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("opening_balance_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/opening_balance_voucher");
  return { success: true, voucherNo: result.voucherNo };
}
