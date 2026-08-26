"use server";

import { revalidatePath } from "next/cache";

import { isCurrentUserAdmin } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  generateUaeRentInvoice,
  postUaeRentInvoice,
} from "@/features/rental/uae-rent-invoices/actions";
import {
  generatePkRentInvoice,
  postPkRentInvoice,
} from "@/features/rental/pk-rent-invoices/actions";

export interface EditInvoiceInput {
  invoiceId: string;
  country: "uae" | "pk";
  amount: number;
  dueDate: string; // yyyy-mm-dd
}

/**
 * Edit a POSTED rent invoice's rent amount and/or due date.
 *
 * Rent invoices post to the ledger and a posted journal entry is immutable, so
 * an edit is done by DELETE → REGENERATE → RE-POST: the old invoice + journal
 * entry are removed (which reopens its schedule period), the schedule is updated
 * with the new amount / due date, and a fresh invoice is generated and posted
 * through the same tested posting path (agent share, HH expenses, PK utilities /
 * advance / tax provision are all reproduced). The original voucher number is
 * kept so the document keeps its identity.
 *
 * Constraints (mirrors the admin delete): admin-only, and the invoice must have
 * NO recorded payments. Only invoices generated from a schedule can be edited.
 */
export async function editPostedRentInvoice(input: EditInvoiceInput) {
  const { invoiceId, country, amount, dueDate } = input;

  if (!(await isCurrentUserAdmin())) {
    return { error: "Only administrators can edit posted invoices." };
  }
  if (!(amount > 0)) return { error: "Amount must be greater than zero." };
  if (!dueDate) return { error: "Enter a due date." };

  const supabase = await createClient();

  if (country === "uae") {
    const { data: inv } = await supabase
      .schema("rental")
      .from("uae_rent_invoices")
      .select("id, lease_id, schedule_id, voucher_no")
      .eq("id", invoiceId)
      .maybeSingle();
    if (!inv) return { error: "Invoice not found." };
    if (!inv.schedule_id) {
      return { error: "This invoice has no schedule and can't be edited. Delete it and recreate from the lease." };
    }
    const { count: payCount } = await supabase
      .schema("rental")
      .from("uae_rent_payments")
      .select("id", { count: "exact", head: true })
      .eq("invoice_id", invoiceId);
    if ((payCount ?? 0) > 0) {
      return { error: "This invoice has recorded payments. Remove the payments before editing." };
    }

    const scheduleId = inv.schedule_id as string;
    const leaseId = inv.lease_id as string;
    const oldVoucherNo = inv.voucher_no as string | null;

    // 1. Remove the posted invoice + journal entry (reopens the schedule).
    const { error: delErr } = await supabase
      .schema("rental")
      .rpc("fn_admin_delete_rent_invoice", { p_invoice_id: invoiceId, p_country: "uae" });
    if (delErr) return { error: delErr.message };

    // 2. Apply the new amount / due date to the reopened schedule period.
    const { error: schErr } = await supabase
      .schema("rental")
      .from("uae_payment_schedules")
      .update({ amount, due_date: dueDate })
      .eq("id", scheduleId);
    if (schErr) return { error: `Invoice removed but reschedule failed: ${schErr.message}` };

    // 3. Regenerate + post from the tested path.
    const gen = await generateUaeRentInvoice(scheduleId);
    if ("error" in gen) return { error: `Invoice removed but regeneration failed: ${gen.error}` };
    const newId = gen.id;

    const { data: newInv } = await supabase
      .schema("rental")
      .from("uae_rent_invoices")
      .select("journal_entry_id")
      .eq("id", newId)
      .maybeSingle();
    if (newInv?.journal_entry_id) {
      const post = await postUaeRentInvoice(newId, newInv.journal_entry_id as string);
      if ("error" in post) return { error: `Invoice regenerated but posting failed: ${post.error}` };
    }

    // 4. Keep the original document number so the invoice keeps its identity.
    if (oldVoucherNo) {
      await supabase.schema("rental").from("uae_rent_invoices").update({ voucher_no: oldVoucherNo }).eq("id", newId);
    }

    revalidatePath("/rental/invoices");
    revalidatePath(`/rental/uae/invoices/${newId}`);
    revalidatePath(`/rental/uae/leases/${leaseId}`);
    return { success: true, id: newId };
  }

  // Pakistan
  const { data: inv } = await supabase
    .schema("rental")
    .from("pk_rent_invoices")
    .select("id, lease_id, schedule_id, voucher_no, advance_adjusted")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { error: "Invoice not found." };
  if (!inv.schedule_id) {
    return { error: "This invoice has no schedule and can't be edited. Delete it and recreate from the lease." };
  }
  const { count: payCount } = await supabase
    .schema("rental")
    .from("pk_rent_payments")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId);
  if ((payCount ?? 0) > 0) {
    return { error: "This invoice has recorded payments. Remove the payments before editing." };
  }

  // Preserve the invoice's utility charges + advance adjustment across the rebuild.
  const { data: utilities } = await supabase
    .schema("rental")
    .from("pk_utility_charges")
    .select("utility_type, amount, description")
    .eq("invoice_id", invoiceId);
  const utilityCharges = (utilities ?? []).map((u) => ({
    utilityType: u.utility_type as "electricity" | "gas" | "water" | "other",
    amount: Number(u.amount),
    description: (u.description as string | null) ?? "",
  }));
  const advanceAdjusted = Number(inv.advance_adjusted) || 0;

  const scheduleId = inv.schedule_id as string;
  const leaseId = inv.lease_id as string;
  const oldVoucherNo = inv.voucher_no as string | null;

  const { error: delErr } = await supabase
    .schema("rental")
    .rpc("fn_admin_delete_rent_invoice", { p_invoice_id: invoiceId, p_country: "pk" });
  if (delErr) return { error: delErr.message };

  const { error: schErr } = await supabase
    .schema("rental")
    .from("pk_payment_schedules")
    .update({ amount, due_date: dueDate })
    .eq("id", scheduleId);
  if (schErr) return { error: `Invoice removed but reschedule failed: ${schErr.message}` };

  const gen = await generatePkRentInvoice(scheduleId, { utilityCharges, advanceAdjusted, scheduleId });
  if ("error" in gen) return { error: `Invoice removed but regeneration failed: ${gen.error}` };
  const newId = gen.id;

  const { data: newInv } = await supabase
    .schema("rental")
    .from("pk_rent_invoices")
    .select("journal_entry_id")
    .eq("id", newId)
    .maybeSingle();
  if (newInv?.journal_entry_id) {
    const post = await postPkRentInvoice(newId, newInv.journal_entry_id as string);
    if ("error" in post) return { error: `Invoice regenerated but posting failed: ${post.error}` };
  }

  if (oldVoucherNo) {
    await supabase.schema("rental").from("pk_rent_invoices").update({ voucher_no: oldVoucherNo }).eq("id", newId);
  }

  revalidatePath("/rental/invoices");
  revalidatePath(`/rental/pk/invoices/${newId}`);
  revalidatePath(`/rental/pk/leases/${leaseId}`);
  return { success: true, id: newId };
}
