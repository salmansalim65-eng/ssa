"use server";

import { revalidatePath } from "next/cache";

import { isCurrentUserAdmin, requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { jvMaintenanceVoucherSchema, type JvMaintenanceVoucherInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function toEntryLines(lines: JvMaintenanceVoucherInput["lines"]): EntryLineInput[] {
  return lines.flatMap((l) => [
    {
      accountId: l.debitAccountId,
      costCenterId: l.costCenterId || null,
      debit: l.amount,
      credit: 0,
      description: l.remarks || null,
    },
    {
      accountId: l.creditAccountId,
      costCenterId: l.costCenterId || null,
      debit: 0,
      credit: l.amount,
      description: l.remarks || null,
    },
  ]);
}

function toMaintenanceLines(voucherId: string, lines: JvMaintenanceVoucherInput["lines"]) {
  return lines.map((l, index) => ({
    voucher_id: voucherId,
    line_no: index + 1,
    cost_center_id: l.costCenterId || null,
    debit_account_id: l.debitAccountId,
    credit_account_id: l.creditAccountId,
    amount: l.amount,
    period_from: l.periodFrom || null,
    period_till: l.periodTill || null,
    remarks: l.remarks || null,
  }));
}

export async function createJvMaintenanceVoucher(input: JvMaintenanceVoucherInput, options?: { autoPostIfAdmin?: boolean }) {
  const parsed = jvMaintenanceVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("jv_maintenance_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;
  const voucherId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "jv_maintenance_voucher",
    voucherId,
    entryDate: parsed.data.entryDate,
    currencyId: parsed.data.currencyId,
    narration: parsed.data.narration || null,
    createdBy,
    lines: toEntryLines(parsed.data.lines),
    exchangeRate: parsed.data.exchangeRate,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("jv_maintenance_vouchers").insert({
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
    .from("jv_maintenance_voucher_lines")
    .insert(toMaintenanceLines(voucherId, parsed.data.lines));
  if (linesErr) return { error: linesErr.message };

  revalidatePath("/accounting/vouchers/jv_maintenance_voucher");
  if (options?.autoPostIfAdmin !== false && (await isCurrentUserAdmin())) {
    try {
      await postJvMaintenanceVoucher(voucherId, je.journalEntryId);
    } catch {
      // Auto-post is best-effort; the created draft remains for manual posting.
    }
  }
  return { success: true, id: voucherId };
}

export async function updateJvMaintenanceVoucher(id: string, input: JvMaintenanceVoucherInput) {
  const parsed = jvMaintenanceVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("jv_maintenance_voucher", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: v } = await supabase
    .schema("accounting")
    .from("jv_maintenance_vouchers")
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
    reference: l.reference ?? null,
  }));
  const { error: insErr } = await supabase.schema("accounting").from("journal_entry_lines").insert(lineRows);
  if (insErr) return { error: insErr.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("jv_maintenance_vouchers")
    .update({
      entry_date: parsed.data.entryDate,
      narration: parsed.data.narration || null,
    })
    .eq("id", id);
  if (vErr) return { error: vErr.message };

  const { error: delLinesErr } = await supabase
    .schema("accounting")
    .from("jv_maintenance_voucher_lines")
    .delete()
    .eq("voucher_id", id);
  if (delLinesErr) return { error: delLinesErr.message };

  const { error: insLinesErr } = await supabase
    .schema("accounting")
    .from("jv_maintenance_voucher_lines")
    .insert(toMaintenanceLines(id, parsed.data.lines));
  if (insLinesErr) return { error: insLinesErr.message };

  revalidatePath("/accounting/vouchers/jv_maintenance_voucher");
  revalidatePath(`/accounting/vouchers/jv_maintenance_voucher/${id}`);
  return { success: true, id };
}

export async function postJvMaintenanceVoucher(id: string, journalEntryId: string) {
  await requirePermission("jv_maintenance_voucher", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "jv_maintenance_voucher", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("jv_maintenance_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/jv_maintenance_voucher");
  return { success: true, voucherNo: result.voucherNo };
}
