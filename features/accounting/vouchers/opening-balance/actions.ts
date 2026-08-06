"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, resolveExchangeRate } from "@/lib/vouchers/engine";
import { openingBalanceVoucherSchema, type OpeningBalanceVoucherInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

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

export async function updateOpeningBalanceVoucher(id: string, input: OpeningBalanceVoucherInput) {
  const parsed = openingBalanceVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("opening_balance_voucher", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: v } = await supabase
    .schema("accounting")
    .from("opening_balance_vouchers")
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

  const exchangeRate = await resolveExchangeRate(companyId, parsed.data.currencyId, parsed.data.asOfDate);
  const amount = parsed.data.debitAmount > 0 ? parsed.data.debitAmount : parsed.data.creditAmount;
  const base = round2(amount * exchangeRate);

  // Line 1 is always the debit line, line 2 the credit line — which account
  // fills each depends on the balance's direction, mirroring create.
  const debitAccount = parsed.data.debitAmount > 0 ? parsed.data.accountId : parsed.data.contraAccountId;
  const creditAccount = parsed.data.debitAmount > 0 ? parsed.data.contraAccountId : parsed.data.accountId;

  const { error: jeErr } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({
      entry_date: parsed.data.asOfDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: exchangeRate,
      narration: "Opening balance",
    })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

  const { error: l1 } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .update({
      account_id: debitAccount,
      debit_amount: amount,
      credit_amount: 0,
      currency_id: parsed.data.currencyId,
      exchange_rate: exchangeRate,
      base_debit_amount: base,
      base_credit_amount: 0,
      description: "Opening balance",
    })
    .eq("journal_entry_id", jeId)
    .eq("line_no", 1);
  if (l1) return { error: l1.message };

  const { error: l2 } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .update({
      account_id: creditAccount,
      debit_amount: 0,
      credit_amount: amount,
      currency_id: parsed.data.currencyId,
      exchange_rate: exchangeRate,
      base_debit_amount: 0,
      base_credit_amount: base,
      description: "Opening balance",
    })
    .eq("journal_entry_id", jeId)
    .eq("line_no", 2);
  if (l2) return { error: l2.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("opening_balance_vouchers")
    .update({
      as_of_date: parsed.data.asOfDate,
      account_id: parsed.data.accountId,
      contra_account_id: parsed.data.contraAccountId,
      currency_id: parsed.data.currencyId,
      debit_amount: parsed.data.debitAmount,
      credit_amount: parsed.data.creditAmount,
    })
    .eq("id", id);
  if (vErr) return { error: vErr.message };

  revalidatePath("/accounting/vouchers/opening_balance_voucher");
  revalidatePath(`/accounting/vouchers/opening_balance_voucher/${id}`);
  return { success: true, id };
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
