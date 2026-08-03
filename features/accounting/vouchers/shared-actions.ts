"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { actOnApproval, getCurrentCompanyId, submitForApproval } from "@/lib/vouchers/engine";
import type { Phase5VoucherType } from "@/lib/vouchers/meta";

export async function submitVoucher(
  voucherType: Phase5VoucherType,
  voucherId: string,
  journalEntryId: string,
  amount: number,
) {
  await requirePermission(voucherType, "edit");
  const companyId = await getCurrentCompanyId();

  const result = await submitForApproval({ companyId, voucherType, voucherId, journalEntryId, amount });
  if ("error" in result) return { error: result.error };

  revalidatePath(`/accounting/vouchers/${voucherType}`);
  return { success: true };
}

export async function actOnVoucher(
  voucherType: Phase5VoucherType,
  voucherApprovalId: string,
  journalEntryId: string,
  action: "approve" | "reject" | "send_back",
  comment?: string,
) {
  await requirePermission(voucherType, action === "approve" ? "approve" : action === "reject" ? "reject" : "edit");

  const result = await actOnApproval({ voucherApprovalId, journalEntryId, action, comment });
  if ("error" in result) return { error: result.error };

  revalidatePath(`/accounting/vouchers/${voucherType}`);
  return { success: true };
}
