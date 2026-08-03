"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId } from "@/lib/vouchers/engine";
import { recordPaymentSchema, type RecordPaymentInput } from "@/features/rental/uae-rent-invoices/schemas";

async function getPostingAccount(companyId: string, accountRole: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("accounting").rpc("fn_get_posting_account", {
    p_company_id: companyId,
    p_voucher_type: "uae_rent_invoice",
    p_account_role: accountRole,
  });
  if (error) throw new Error(error.message);
  return data as string | null;
}

/**
 * Records money received against a specific invoice. Posts its own small
 * JE immediately (Dr Cash/Bank, Cr Tenant Receivable) rather than routing
 * through the draft -> approval -> post pipeline every primary voucher
 * type uses — collecting an already-invoiced, already-approved rent
 * payment doesn't need a second approval cycle.
 */
export async function recordUaeRentPayment(invoiceId: string, input: RecordPaymentInput) {
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("uae_rent_invoice", "create");
  await requirePermission("uae_rent_invoice", "post");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const { data: invoice, error: invoiceError } = await supabase
    .schema("rental")
    .from("uae_rent_invoices")
    .select("currency_id, outstanding_balance, journal_entries:journal_entry_id(status)")
    .eq("id", invoiceId)
    .single();
  if (invoiceError || !invoice) return { error: "Invoice not found" };

  const status = (invoice.journal_entries as unknown as { status: string } | null)?.status;
  if (status !== "posted") return { error: "Invoice must be posted before recording a payment" };
  if (parsed.data.amount > invoice.outstanding_balance) {
    return { error: `Payment exceeds outstanding balance of ${invoice.outstanding_balance}` };
  }

  const tenantReceivableId = await getPostingAccount(companyId, "tenant_receivable");
  if (!tenantReceivableId) {
    return { error: "Configure Posting Templates for UAE Rent Invoice first (Tenant Receivable account)." };
  }

  const paymentId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "uae_rent_invoice",
    voucherId: paymentId,
    entryDate: parsed.data.paymentDate,
    currencyId: invoice.currency_id,
    narration: "UAE rent payment received",
    createdBy,
    lines: [
      { accountId: parsed.data.cashBankAccountId, debit: parsed.data.amount, credit: 0, description: "Rent received" },
      { accountId: tenantReceivableId, debit: 0, credit: parsed.data.amount, description: "Rent received" },
    ],
  });
  if ("error" in je) return { error: je.error };

  const { error: postError } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({ status: "posted" })
    .eq("id", je.journalEntryId);
  if (postError) return { error: postError.message };

  const { error } = await supabase.schema("rental").from("uae_rent_payments").insert({
    id: paymentId,
    company_id: companyId,
    invoice_id: invoiceId,
    journal_entry_id: je.journalEntryId,
    payment_date: parsed.data.paymentDate,
    amount: parsed.data.amount,
    cash_bank_account_id: parsed.data.cashBankAccountId,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  revalidatePath(`/rental/uae/invoices/${invoiceId}`);
  return { success: true };
}
