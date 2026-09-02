"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, routeNewVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { journalVoucherSchema, type JournalVoucherInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Each grid row (cost centre + debit account + credit account + amount) expands
// into a balanced debit line and credit line, both tagged with the cost centre.
function toEntryLines(lines: JournalVoucherInput["lines"]): EntryLineInput[] {
  return lines.flatMap((l) => [
    { accountId: l.debitAccountId, costCenterId: l.costCenterId || null, debit: l.amount, credit: 0, description: null },
    { accountId: l.creditAccountId, costCenterId: l.costCenterId || null, debit: 0, credit: l.amount, description: null },
  ]);
}

function toVoucherLines(voucherId: string, lines: JournalVoucherInput["lines"]) {
  return lines.map((l, index) => ({
    voucher_id: voucherId,
    line_no: index + 1,
    cost_center_id: l.costCenterId || null,
    debit_account_id: l.debitAccountId,
    credit_account_id: l.creditAccountId,
    amount: l.amount,
  }));
}

export async function createJournalVoucher(input: JournalVoucherInput, options?: { autoPostIfAdmin?: boolean }) {
  const parsed = journalVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("journal_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;
  const voucherId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "journal_voucher",
    voucherId,
    entryDate: parsed.data.entryDate,
    currencyId: parsed.data.currencyId,
    narration: parsed.data.narration || null,
    createdBy,
    lines: toEntryLines(parsed.data.lines),
    exchangeRate: parsed.data.exchangeRate,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("journal_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    entry_date: parsed.data.entryDate,
    narration: parsed.data.narration || null,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  const { error: linesErr } = await supabase
    .schema("accounting")
    .from("journal_voucher_lines")
    .insert(toVoucherLines(voucherId, parsed.data.lines));
  if (linesErr) return { error: linesErr.message };

  revalidatePath("/accounting/vouchers/journal_voucher");
  // An admin's voucher posts on the spot; anyone else's goes straight to the
  // approver — no "Submit for approval" click in between.
  if (options?.autoPostIfAdmin !== false) {
    await routeNewVoucher({
      companyId,
      voucherType: "journal_voucher",
      voucherId,
      journalEntryId: je.journalEntryId,
      post: () => postJournalVoucher(voucherId, je.journalEntryId),
    });
  }
  return { success: true, id: voucherId };
}

export async function updateJournalVoucher(id: string, input: JournalVoucherInput) {
  const parsed = journalVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("journal_voucher", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: v } = await supabase
    .schema("accounting")
    .from("journal_vouchers")
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

  const rate = parsed.data.exchangeRate;

  const { error: jeErr } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({
      entry_date: parsed.data.entryDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: rate,
      narration: parsed.data.narration || null,
    })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

  const { error: delErr } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .delete()
    .eq("journal_entry_id", jeId);
  if (delErr) return { error: delErr.message };

  const lineRows = toEntryLines(parsed.data.lines).map((l, index) => ({
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
  const { error: insErr } = await supabase.schema("accounting").from("journal_entry_lines").insert(lineRows);
  if (insErr) return { error: insErr.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("journal_vouchers")
    .update({
      entry_date: parsed.data.entryDate,
      narration: parsed.data.narration || null,
    })
    .eq("id", id);
  if (vErr) return { error: vErr.message };

  const { error: delLinesErr } = await supabase
    .schema("accounting")
    .from("journal_voucher_lines")
    .delete()
    .eq("voucher_id", id);
  if (delLinesErr) return { error: delLinesErr.message };

  const { error: insLinesErr } = await supabase
    .schema("accounting")
    .from("journal_voucher_lines")
    .insert(toVoucherLines(id, parsed.data.lines));
  if (insLinesErr) return { error: insLinesErr.message };

  revalidatePath("/accounting/vouchers/journal_voucher");
  revalidatePath(`/accounting/vouchers/journal_voucher/${id}`);
  return { success: true, id };
}

export async function postJournalVoucher(id: string, journalEntryId: string) {
  await requirePermission("journal_voucher", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "journal_voucher", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("journal_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/journal_voucher");
  return { success: true, voucherNo: result.voucherNo };
}
