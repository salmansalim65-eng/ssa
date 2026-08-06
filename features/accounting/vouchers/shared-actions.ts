"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { actOnApproval, getCurrentCompanyId, submitForApproval } from "@/lib/vouchers/engine";
import type { VoucherType } from "@/types/database.types";

export async function submitVoucher(
  voucherType: VoucherType,
  voucherId: string,
  journalEntryId: string,
  amount: number,
) {
  await requirePermission(voucherType, "edit");
  const companyId = await getCurrentCompanyId();

  const result = await submitForApproval({ companyId, voucherType, voucherId, journalEntryId, amount });
  if ("error" in result) return { error: result.error };

  return { success: true };
}

export async function deleteAccountingVoucher(voucherType: VoucherType, id: string) {
  await requirePermission(voucherType, "delete");
  const supabase = await createClient();
  // Definer function removes the draft voucher header, its approvals and its
  // journal entry (+ lines); it refuses anything already posted.
  const { error } = await supabase
    .schema("accounting")
    .rpc("fn_delete_draft_voucher", { p_voucher_type: voucherType, p_id: id });
  if (error) return { error: error.message };

  revalidatePath(`/accounting/vouchers/${voucherType}`);
  return { success: true };
}

export async function actOnVoucher(
  voucherType: VoucherType,
  voucherApprovalId: string,
  journalEntryId: string,
  action: "approve" | "reject" | "send_back",
  comment?: string,
) {
  await requirePermission(voucherType, action === "approve" ? "approve" : action === "reject" ? "reject" : "edit");

  const result = await actOnApproval({ voucherApprovalId, journalEntryId, action, comment });
  if ("error" in result) return { error: result.error };

  return { success: true };
}
