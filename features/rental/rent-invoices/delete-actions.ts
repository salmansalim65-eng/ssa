"use server";

import { revalidatePath } from "next/cache";

import { isCurrentUserAdmin } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

/**
 * Admin-only delete of a POSTED rent invoice. Rent invoices are regenerable from
 * their schedule, so this actually removes the invoice (and its journal entry)
 * and reopens the schedule period, rather than leaving a reversed document
 * behind. Refuses invoices that already have recorded payments.
 */
export async function deletePostedRentInvoice(invoiceId: string, country: "uae" | "pk") {
  if (!(await isCurrentUserAdmin())) {
    return { error: "Only administrators can delete posted invoices." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .schema("rental")
    .rpc("fn_admin_delete_rent_invoice", { p_invoice_id: invoiceId, p_country: country });
  if (error) return { error: error.message };

  revalidatePath(`/rental/${country}/invoices`);
  return { success: true };
}
