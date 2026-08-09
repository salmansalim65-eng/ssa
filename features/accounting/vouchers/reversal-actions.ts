"use server";

import { revalidatePath } from "next/cache";

import { isCurrentUserAdmin } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

/**
 * Admin-only "delete" of a POSTED voucher or invoice. Posts a reversing journal
 * entry (net ledger effect zero) rather than physically deleting ledger history;
 * re-doable downstream state (a sold asset, an invoiced rent schedule) is
 * reopened. `revalidate` paths are refreshed so the caller's list/detail update.
 */
export async function reversePostedDocument(journalEntryId: string, revalidate: string[] = []) {
  if (!(await isCurrentUserAdmin())) {
    return { error: "Only administrators can delete posted documents." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .rpc("fn_admin_reverse_voucher", { p_journal_entry_id: journalEntryId });
  if (error) return { error: error.message };

  for (const path of revalidate) revalidatePath(path);
  return { success: true };
}
