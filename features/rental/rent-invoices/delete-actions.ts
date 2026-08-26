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

  // A combined voucher invoice (schedule_id null) owns the voucher's leases —
  // they exist only to feed the month-wise reports for THIS invoice. The delete
  // RPC removes the invoice and its journal entry but leaves those leases behind,
  // so capture the voucher's document number first and soft-delete its leases
  // after; otherwise they linger and double the lists and reports. Schedule-based
  // invoices keep their lease (it has many invoices), so they're left untouched.
  let voucherDocNo: string | null = null;
  if (country === "uae") {
    const { data: inv } = await supabase
      .schema("rental")
      .from("uae_rent_invoices")
      .select("lease_id, schedule_id")
      .eq("id", invoiceId)
      .maybeSingle();
    if (inv && !inv.schedule_id && inv.lease_id) {
      const { data: lease } = await supabase
        .schema("rental")
        .from("uae_leases")
        .select("document_no")
        .eq("id", inv.lease_id)
        .maybeSingle();
      voucherDocNo = (lease?.document_no as string | null) ?? null;
    }
  }

  const { error } = await supabase
    .schema("rental")
    .rpc("fn_admin_delete_rent_invoice", { p_invoice_id: invoiceId, p_country: country });
  if (error) return { error: error.message };

  if (voucherDocNo) {
    // Retire the voucher's leases through the admin helper (SECURITY DEFINER),
    // which bypasses the uae_leases RLS that otherwise rejects the update even
    // for admins. Fall back to a direct update on databases where the helper
    // isn't added yet.
    const { error: rpcErr } = await supabase
      .schema("rental")
      .rpc("fn_admin_soft_delete_voucher_leases", { p_document_no: voucherDocNo });
    if (rpcErr) {
      const { data: user } = await supabase.auth.getUser();
      await supabase
        .schema("rental")
        .from("uae_leases")
        .update({ deleted_at: new Date().toISOString(), deleted_by: user.user!.id })
        .eq("document_no", voucherDocNo)
        .is("deleted_at", null);
    }
  }

  revalidatePath(`/rental/${country}/invoices`);
  revalidatePath("/rental/uae/leases");
  revalidatePath("/rental/uae/hh-lease");
  revalidatePath("/dashboard");
  return { success: true };
}
