"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, routeNewVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { openingBalanceVoucherSchema, type OpeningBalanceVoucherInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Body lines plus a balancing entry on the contra account for the net.
function buildEntryLines(
  lines: OpeningBalanceVoucherInput["lines"],
  contraAccountId: string,
  costCenterId: string | null,
) {
  const sumD = lines.reduce((s, l) => s + l.debit, 0);
  const sumC = lines.reduce((s, l) => s + l.credit, 0);
  const net = round2(sumD - sumC);
  const jeLines: EntryLineInput[] = lines.map((l) => ({
    accountId: l.accountId,
    costCenterId,
    debit: l.debit,
    credit: l.credit,
    description: l.remarks || "Opening balance",
  }));
  if (net !== 0) {
    jeLines.push({
      accountId: contraAccountId,
      costCenterId,
      debit: net < 0 ? -net : 0,
      credit: net > 0 ? net : 0,
      description: "Opening balance",
    });
  }
  return { jeLines, total: Math.max(sumD, sumC) };
}

export async function createOpeningBalanceVoucher(input: OpeningBalanceVoucherInput, options?: { autoPostIfAdmin?: boolean }) {
  const parsed = openingBalanceVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("opening_balance_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const costCenterId = parsed.data.costCenterId || null;
  const { jeLines, total } = buildEntryLines(parsed.data.lines, parsed.data.contraAccountId, costCenterId);
  if (total <= 0) return { error: "Enter at least one debit or credit amount" };
  const voucherId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "opening_balance_voucher",
    voucherId,
    entryDate: parsed.data.asOfDate,
    currencyId: parsed.data.currencyId,
    narration: parsed.data.narration || "Opening balance",
    createdBy,
    lines: jeLines,
    exchangeRate: parsed.data.exchangeRate,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("opening_balance_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    as_of_date: parsed.data.asOfDate,
    contra_account_id: parsed.data.contraAccountId,
    cost_center_id: costCenterId,
    currency_id: parsed.data.currencyId,
    exchange_rate: je.exchangeRate,
    narration: parsed.data.narration || null,
    total_amount: total,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  const lineRows = parsed.data.lines.map((l, index) => ({
    voucher_id: voucherId,
    line_no: index + 1,
    account_id: l.accountId,
    debit: l.debit,
    credit: l.credit,
    remarks: l.remarks || null,
  }));
  const { error: linesError } = await supabase
    .schema("accounting")
    .from("opening_balance_voucher_lines")
    .insert(lineRows);
  if (linesError) return { error: linesError.message };

  revalidatePath("/accounting/vouchers/opening_balance_voucher");
  // An admin's voucher posts on the spot; anyone else's goes straight to the
  // approver — no "Submit for approval" click in between.
  if (options?.autoPostIfAdmin !== false) {
    await routeNewVoucher({
      companyId,
      voucherType: "opening_balance_voucher",
      voucherId,
      journalEntryId: je.journalEntryId,
      post: () => postOpeningBalanceVoucher(voucherId, je.journalEntryId),
    });
  }
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
  // Opening balances stay editable after posting (they're corrections to the
  // opening figures, with no downstream vouchers referencing them); the JE lines
  // and base amounts below are simply rewritten in place, keeping it posted.

  const costCenterId = parsed.data.costCenterId || null;
  const rate = parsed.data.exchangeRate;
  const { jeLines, total } = buildEntryLines(parsed.data.lines, parsed.data.contraAccountId, costCenterId);
  if (total <= 0) return { error: "Enter at least one debit or credit amount" };

  const { error: jeErr } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({
      entry_date: parsed.data.asOfDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || "Opening balance",
    })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

  const { error: delJe } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .delete()
    .eq("journal_entry_id", jeId);
  if (delJe) return { error: delJe.message };

  const jeRows = jeLines.map((l, index) => ({
    journal_entry_id: jeId,
    line_no: index + 1,
    account_id: l.accountId,
    cost_center_id: l.costCenterId ?? null,
    debit_amount: l.debit,
    credit_amount: l.credit,
    currency_id: parsed.data.currencyId,
    exchange_rate: rate,
    base_debit_amount: round2(l.debit * rate),
    base_credit_amount: round2(l.credit * rate),
    description: l.description ?? null,
  }));
  const { error: insJe } = await supabase.schema("accounting").from("journal_entry_lines").insert(jeRows);
  if (insJe) return { error: insJe.message };

  const { error: delLines } = await supabase
    .schema("accounting")
    .from("opening_balance_voucher_lines")
    .delete()
    .eq("voucher_id", id);
  if (delLines) return { error: delLines.message };

  const lineRows = parsed.data.lines.map((l, index) => ({
    voucher_id: id,
    line_no: index + 1,
    account_id: l.accountId,
    debit: l.debit,
    credit: l.credit,
    remarks: l.remarks || null,
  }));
  const { error: insLines } = await supabase
    .schema("accounting")
    .from("opening_balance_voucher_lines")
    .insert(lineRows);
  if (insLines) return { error: insLines.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("opening_balance_vouchers")
    .update({
      as_of_date: parsed.data.asOfDate,
      contra_account_id: parsed.data.contraAccountId,
      cost_center_id: costCenterId,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || null,
      total_amount: total,
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
