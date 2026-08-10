"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId } from "@/lib/vouchers/engine";
import { recordPkPaymentSchema, type RecordPkPaymentInput } from "@/features/rental/pk-rent-invoices/schemas";

async function getPostingAccount(companyId: string, accountRole: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("accounting").rpc("fn_get_posting_account", {
    p_company_id: companyId,
    p_voucher_type: "pk_rent_invoice",
    p_account_role: accountRole,
  });
  if (error) throw new Error(error.message);
  return data as string | null;
}

// The tenant's own account and the leased asset's cost centre, so the payment
// credit clears the same tenant-ledger line the invoice debited and carries the
// same country attribution. Both return null when unavailable (older data).
async function getLeasePostingContext(companyId: string, leaseId: string) {
  const supabase = await createClient();
  const { data: lease } = await supabase
    .schema("rental")
    .from("pk_leases")
    .select("tenant_id, asset_id")
    .eq("id", leaseId)
    .maybeSingle();
  if (!lease) return { tenantAccountId: null, costCenterId: null };

  const [tenant, cc] = await Promise.all([
    lease.tenant_id
      ? supabase.schema("rental").from("tenants").select("account_id").eq("company_id", companyId).eq("id", lease.tenant_id).maybeSingle()
      : Promise.resolve({ data: null }),
    lease.asset_id
      ? supabase.schema("accounting").from("cost_centers").select("id").eq("asset_id", lease.asset_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    tenantAccountId: (tenant.data?.account_id as string | undefined) ?? null,
    costCenterId: (cc.data?.id as string | undefined) ?? null,
  };
}

/**
 * Records money received against a specific invoice. Posts its own small
 * JE immediately (Dr Cash/Bank, Cr Tenant Receivable) rather than routing
 * through the draft -> approval -> post pipeline, same as
 * recordUaeRentPayment in Phase 9.
 */
export async function recordPkRentPayment(invoiceId: string, input: RecordPkPaymentInput) {
  const parsed = recordPkPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("pk_rent_invoice", "create");
  await requirePermission("pk_rent_invoice", "post");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const { data: invoice, error: invoiceError } = await supabase
    .schema("rental")
    .from("pk_rent_invoices")
    .select("currency_id, outstanding_amount, journal_entry_id, lease_id")
    .eq("id", invoiceId)
    .single();
  if (invoiceError || !invoice) return { error: "Invoice not found" };

  // journal_entries live in the `accounting` schema, which PostgREST cannot
  // embed across from `rental`; look the status up directly instead.
  let status: string | undefined;
  if (invoice.journal_entry_id) {
    const { data: je } = await supabase
      .schema("accounting")
      .from("journal_entries")
      .select("status")
      .eq("id", invoice.journal_entry_id)
      .maybeSingle();
    status = (je as { status: string } | null)?.status;
  }
  if (status !== "posted") return { error: "Invoice must be posted before recording a payment" };
  if (parsed.data.amount > invoice.outstanding_amount) {
    return { error: `Payment exceeds outstanding amount of ${invoice.outstanding_amount}` };
  }

  const tenantReceivableId = await getPostingAccount(companyId, "tenant_receivable");
  if (!tenantReceivableId) {
    return { error: "Configure Posting Templates for Pakistan Rent Invoice first (Tenant Receivable account)." };
  }
  // Credit the tenant's own account (matching the invoice debit) so the payment
  // clears the receivable in the tenant's own ledger; carry the same cost centre.
  const { tenantAccountId, costCenterId } = await getLeasePostingContext(companyId, invoice.lease_id);
  const receivableAccountId = tenantAccountId ?? tenantReceivableId;

  const paymentId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "pk_rent_invoice",
    voucherId: paymentId,
    entryDate: parsed.data.paymentDate,
    currencyId: invoice.currency_id,
    narration: "Pakistan rent payment received",
    createdBy,
    lines: [
      { accountId: parsed.data.cashBankAccountId, costCenterId, debit: parsed.data.amount, credit: 0, description: "Rent received" },
      { accountId: receivableAccountId, costCenterId, debit: 0, credit: parsed.data.amount, description: "Rent received" },
    ],
  });
  if ("error" in je) return { error: je.error };

  const { error: postError } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({ status: "posted" })
    .eq("id", je.journalEntryId);
  if (postError) return { error: postError.message };

  const { error } = await supabase.schema("rental").from("pk_rent_payments").insert({
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

  revalidatePath(`/rental/pk/invoices/${invoiceId}`);
  return { success: true };
}
