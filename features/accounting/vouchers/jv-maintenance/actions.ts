"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher } from "@/lib/vouchers/engine";
import { jvMaintenanceVoucherSchema, type JvMaintenanceVoucherInput } from "./schemas";

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
