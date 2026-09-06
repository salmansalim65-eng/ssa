"use server";

import { revalidatePath } from "next/cache";

import { isCurrentUserAdmin, requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  createJournalEntry,
  EDITABLE_STATUSES,
  ensureCanEditVoucher,
  getCurrentCompanyId,
  postVoucher,
  resubmitEditedVoucher,
  routeNewVoucher,
  type EntryLineInput,
} from "@/lib/vouchers/engine";
import { chequeReturnVoucherSchema, type ChequeReturnVoucherInput } from "./schemas";

type OriginalPdc = {
  debit_account_id: string;
  credit_account_id: string;
  amount: number;
  currency_id: string;
  pdc_status: string;
};

type ChequeReturnSupabase = Awaited<ReturnType<typeof createClient>>;

/** The PDC being returned, read from whichever of the two tables holds it. */
async function loadOriginalPdc(
  supabase: ChequeReturnSupabase,
  companyId: string,
  pdcId: string,
  pdcType: ChequeReturnVoucherInput["originalPdcType"],
): Promise<{ original: OriginalPdc } | { error: string }> {
  const table = pdcType === "pdc_payment_voucher" ? "pdc_payment_vouchers" : "pdc_receipt_vouchers";
  const { data, error } = await supabase
    .schema("accounting")
    .from(table)
    .select("id, debit_account_id, credit_account_id, amount, currency_id, pdc_status")
    .eq("company_id", companyId)
    .eq("id", pdcId)
    .single();
  if (error || !data) return { error: "Original cheque not found" };
  return { original: data as unknown as OriginalPdc };
}

/** The reversal, plus the penalty legs when one is charged. */
function buildReturnLines(original: OriginalPdc, data: ChequeReturnVoucherInput): EntryLineInput[] {
  const lines: EntryLineInput[] = [
    { accountId: original.credit_account_id, debit: original.amount, credit: 0, description: "Cheque return reversal" },
    { accountId: original.debit_account_id, debit: 0, credit: original.amount, description: "Cheque return reversal" },
  ];

  if (data.penaltyAmount > 0 && data.penaltyAccountId) {
    if (data.originalPdcType === "pdc_payment_voucher") {
      lines.push(
        { accountId: data.penaltyAccountId, debit: data.penaltyAmount, credit: 0, description: "Cheque return penalty" },
        { accountId: original.credit_account_id, debit: 0, credit: data.penaltyAmount, description: "Cheque return penalty" },
      );
    } else {
      lines.push(
        { accountId: original.debit_account_id, debit: data.penaltyAmount, credit: 0, description: "Cheque return penalty" },
        { accountId: data.penaltyAccountId, debit: 0, credit: data.penaltyAmount, description: "Cheque return penalty" },
      );
    }
  }
  return lines;
}

/** Moves the cheque a return was (or is being) raised against back and forth. */
async function setOriginalPdcStatus(
  supabase: ChequeReturnSupabase,
  pdcType: string,
  pdcId: string,
  status: "pending" | "returned",
) {
  const table = pdcType === "pdc_payment_voucher" ? "pdc_payment_vouchers" : "pdc_receipt_vouchers";
  const { error } = await supabase
    .schema("accounting")
    .from(table)
    .update({ pdc_status: status })
    .eq("id", pdcId);
  return error?.message ?? null;
}

/**
 * The reversal simply swaps the original PDC's two accounts for its full
 * amount, undoing the transaction exactly. A penalty is modeled as
 * partially re-applying the original liability/asset account (by the
 * penalty amount) against a user-chosen penalty account — see the
 * migration's design notes for why a full three-account model (bank
 * charges hitting cash directly) isn't implemented here.
 */
export async function createChequeReturnVoucher(input: ChequeReturnVoucherInput, options?: { autoPostIfAdmin?: boolean }) {
  const parsed = chequeReturnVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("cheque_return_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const loaded = await loadOriginalPdc(supabase, companyId, parsed.data.originalPdcId, parsed.data.originalPdcType);
  if ("error" in loaded) return { error: loaded.error };
  const original = loaded.original;
  if (original.pdc_status !== "pending") {
    return { error: `This cheque is already ${original.pdc_status}` };
  }

  const lines = buildReturnLines(original, parsed.data);

  const voucherId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "cheque_return_voucher",
    voucherId,
    entryDate: parsed.data.returnDate,
    currencyId: original.currency_id,
    narration: parsed.data.returnReason,
    createdBy,
    lines,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("cheque_return_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    original_pdc_type: parsed.data.originalPdcType,
    original_pdc_id: parsed.data.originalPdcId,
    return_date: parsed.data.returnDate,
    return_reason: parsed.data.returnReason,
    penalty_amount: parsed.data.penaltyAmount,
    penalty_account_id: parsed.data.penaltyAccountId || null,
    currency_id: original.currency_id,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  revalidatePath("/accounting/vouchers/cheque_return_voucher");
  // An admin's voucher posts on the spot; anyone else's goes straight to the
  // approver — no "Submit for approval" click in between.
  if (options?.autoPostIfAdmin !== false) {
    await routeNewVoucher({
      companyId,
      voucherType: "cheque_return_voucher",
      voucherId,
      journalEntryId: je.journalEntryId,
      post: () => postChequeReturnVoucher(voucherId, je.journalEntryId),
    });
  }
  return { success: true, id: voucherId };
}

/**
 * A cheque return is derived entirely from the cheque it reverses, so an edit
 * rebuilds the entry from whichever cheque is named — which may not be the one
 * it was raised against.
 */
export async function updateChequeReturnVoucher(id: string, input: ChequeReturnVoucherInput) {
  const parsed = chequeReturnVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: v } = await supabase
    .schema("accounting")
    .from("cheque_return_vouchers")
    .select("journal_entry_id, original_pdc_type, original_pdc_id")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!v) return { error: "Voucher not found" };

  const jeId = v.journal_entry_id;
  const { data: je } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .select("status, created_by")
    .eq("id", jeId)
    .single();
  if (!je) return { error: "Voucher not found" };
  // The Edit permission, or your own voucher while it is unposted.
  const notAllowed = await ensureCanEditVoucher("cheque_return_voucher", je);
  if (notAllowed) return { error: notAllowed };

  // A posted journal entry is immutable, so editing a POSTED return reverses it
  // and re-creates it from the edited values. Posting the return marked its
  // cheque 'returned', so the cheque goes back to 'pending' first — otherwise
  // the replacement is refused, and a return moved to a DIFFERENT cheque would
  // leave the old one marked returned with nothing to show for it.
  if (je.status === "posted") {
    if (!(await isCurrentUserAdmin())) {
      return { error: "Only administrators can edit a posted cheque return voucher." };
    }
    const resetErr = await setOriginalPdcStatus(
      supabase,
      v.original_pdc_type as string,
      v.original_pdc_id as string,
      "pending",
    );
    if (resetErr) return { error: resetErr };

    const { error: delErr } = await supabase
      .schema("accounting")
      .rpc("fn_admin_delete_posted_voucher", { p_voucher_type: "cheque_return_voucher", p_id: id });
    if (delErr) return { error: delErr.message };

    const created = await createChequeReturnVoucher(parsed.data);
    if ("error" in created) return { error: created.error };

    revalidatePath("/accounting/vouchers/cheque_return_voucher");
    revalidatePath("/dashboard");
    return { success: true, id: created.id };
  }
  if (!EDITABLE_STATUSES.includes(je.status)) {
    return { error: "This cheque return can no longer be edited" };
  }

  // Unposted: the cheque is still 'pending' either way (its status only moves at
  // posting), so the entry is simply rebuilt in place and the voucher keeps its
  // id — an approval already in flight still points at it.
  const loaded = await loadOriginalPdc(supabase, companyId, parsed.data.originalPdcId, parsed.data.originalPdcType);
  if ("error" in loaded) return { error: loaded.error };
  const original = loaded.original;
  if (original.pdc_status !== "pending") {
    return { error: `This cheque is already ${original.pdc_status}` };
  }

  const { error: jeErr } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({
      entry_date: parsed.data.returnDate,
      currency_id: original.currency_id,
      narration: parsed.data.returnReason,
    })
    .eq("id", jeId);
  if (jeErr) return { error: jeErr.message };

  const { error: delLines } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .delete()
    .eq("journal_entry_id", jeId);
  if (delLines) return { error: delLines.message };

  const { data: rateRow } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .select("exchange_rate")
    .eq("id", jeId)
    .single();
  const rate = Number(rateRow?.exchange_rate ?? 1) || 1;

  const lineRows = buildReturnLines(original, parsed.data).map((l, index) => ({
    journal_entry_id: jeId,
    line_no: index + 1,
    account_id: l.accountId,
    cost_center_id: l.costCenterId ?? null,
    debit_amount: l.debit,
    credit_amount: l.credit,
    currency_id: original.currency_id,
    exchange_rate: rate,
    base_debit_amount: Math.round(l.debit * rate * 100) / 100,
    base_credit_amount: Math.round(l.credit * rate * 100) / 100,
    description: l.description ?? null,
  }));
  const { error: insLines } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .insert(lineRows);
  if (insLines) return { error: insLines.message };

  const { error: headerErr } = await supabase
    .schema("accounting")
    .from("cheque_return_vouchers")
    .update({
      original_pdc_type: parsed.data.originalPdcType,
      original_pdc_id: parsed.data.originalPdcId,
      return_date: parsed.data.returnDate,
      return_reason: parsed.data.returnReason,
      penalty_amount: parsed.data.penaltyAmount,
      penalty_account_id: parsed.data.penaltyAccountId || null,
      currency_id: original.currency_id,
    })
    .eq("id", id);
  if (headerErr) return { error: headerErr.message };

  await resubmitEditedVoucher({
    companyId,
    voucherType: "cheque_return_voucher",
    voucherId: id,
    journalEntryId: jeId,
    previousStatus: je.status,
  });

  revalidatePath("/accounting/vouchers/cheque_return_voucher");
  revalidatePath("/dashboard");
  return { success: true, id };
}

export async function postChequeReturnVoucher(id: string, journalEntryId: string) {
  await requirePermission("cheque_return_voucher", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "cheque_return_voucher", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { data: voucher, error: fetchError } = await supabase
    .schema("accounting")
    .from("cheque_return_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id)
    .select("original_pdc_type, original_pdc_id")
    .single();
  if (fetchError || !voucher) return { error: fetchError?.message ?? "Failed to update voucher" };

  const table = voucher.original_pdc_type === "pdc_payment_voucher" ? "pdc_payment_vouchers" : "pdc_receipt_vouchers";
  const { data: statusRow, error: statusError } = await supabase
    .schema("accounting")
    .from(table)
    .update({ pdc_status: "returned" })
    .eq("id", voucher.original_pdc_id)
    .select("id")
    .maybeSingle();
  if (statusError) return { error: statusError.message };
  if (!statusRow) return { error: "Not permitted to update the original cheque's status" };

  revalidatePath("/accounting/vouchers/cheque_return_voucher");
  revalidatePath("/accounting/vouchers/pdc_payment_voucher");
  revalidatePath("/accounting/vouchers/pdc_receipt_voucher");
  return { success: true, voucherNo: result.voucherNo };
}
