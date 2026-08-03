"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher } from "@/lib/vouchers/engine";
import { journalVoucherSchema, type JournalVoucherInput } from "./schemas";

export async function createJournalVoucher(input: JournalVoucherInput) {
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
    narration: parsed.data.narration,
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

  const { error } = await supabase.schema("accounting").from("journal_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    entry_date: parsed.data.entryDate,
    narration: parsed.data.narration,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/journal_voucher");
  return { success: true, id: voucherId };
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
