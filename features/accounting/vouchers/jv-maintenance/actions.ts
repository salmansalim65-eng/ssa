"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, resolveExchangeRate } from "@/lib/vouchers/engine";
import { jvMaintenanceVoucherSchema, type JvMaintenanceVoucherInput } from "./schemas";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function createJvMaintenanceVoucher(input: JvMaintenanceVoucherInput) {
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
    narration: parsed.data.adjustmentReason,
    createdBy,
    lines: parsed.data.lines.map((l) => ({
      accountId: l.accountId,
      costCenterId: l.costCenterId || null,
      debit: l.debit,
      credit: l.credit,
      description: l.description || null,
    })),
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("jv_maintenance_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    original_jv_id: parsed.data.originalJvId,
    adjustment_reason: parsed.data.adjustmentReason,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/jv_maintenance_voucher");
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

  const exchangeRate = await resolveExchangeRate(companyId, parsed.data.currencyId, parsed.data.entryDate);

  const { error: jeErr } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({
      entry_date: parsed.data.entryDate,
      currency_id: parsed.data.currencyId,
      exchange_rate: exchangeRate,
      narration: parsed.data.adjustmentReason,
    })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

  // Variable line count — replace the whole set (see updateJournalVoucher).
  const { error: delErr } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .delete()
    .eq("journal_entry_id", jeId);
  if (delErr) return { error: delErr.message };

  const lineRows = parsed.data.lines.map((l, index) => ({
    journal_entry_id: jeId,
    line_no: index + 1,
    account_id: l.accountId,
    cost_center_id: l.costCenterId || null,
    debit_amount: l.debit,
    credit_amount: l.credit,
    currency_id: parsed.data.currencyId,
    exchange_rate: exchangeRate,
    base_debit_amount: round2(l.debit * exchangeRate),
    base_credit_amount: round2(l.credit * exchangeRate),
    description: l.description || null,
  }));
  const { error: insErr } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .insert(lineRows);
  if (insErr) return { error: insErr.message };

  const { error: vErr } = await supabase
    .schema("accounting")
    .from("jv_maintenance_vouchers")
    .update({ original_jv_id: parsed.data.originalJvId, adjustment_reason: parsed.data.adjustmentReason })
    .eq("id", id);
  if (vErr) return { error: vErr.message };

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
