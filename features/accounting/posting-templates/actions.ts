"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { VoucherType } from "@/types/database.types";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

export async function setPostingTemplateAccount(
  voucherType: VoucherType,
  accountRole: string,
  debitOrCredit: "debit" | "credit",
  accountId: string,
) {
  await requirePermission("posting_templates", "edit");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data: existing } = await supabase
    .schema("accounting")
    .from("posting_templates")
    .select("id")
    .eq("company_id", companyId)
    .eq("voucher_type", voucherType)
    .eq("account_role", accountRole)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .schema("accounting")
        .from("posting_templates")
        .update({ account_id: accountId })
        .eq("id", existing.id)
    : await supabase.schema("accounting").from("posting_templates").insert({
        company_id: companyId,
        voucher_type: voucherType,
        account_role: accountRole,
        debit_or_credit: debitOrCredit,
        account_id: accountId,
        created_by: user.user!.id,
      });

  if (error) return { error: error.message };

  revalidatePath("/admin/posting-templates");
  return { success: true };
}
