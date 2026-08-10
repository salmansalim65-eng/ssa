"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { generatePkInvoiceSchema, type GeneratePkInvoiceInput } from "./schemas";

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

// The cost centre tied to a leased asset carries the country attribution used
// by the financial reports. Returns null when the asset has no cost centre.
async function getAssetCostCenterId(assetId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .select("id")
    .eq("asset_id", assetId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// The tenant's own Chart-of-Accounts account, so the receivable debits the
// tenant's individual ledger rather than a shared receivable control account.
// Returns null when the tenant has no linked account (older tenants).
async function getTenantAccountId(companyId: string, tenantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("rental")
    .from("tenants")
    .select("account_id")
    .eq("company_id", companyId)
    .eq("id", tenantId)
    .maybeSingle();
  return (data?.account_id as string | undefined) ?? null;
}

export async function generatePkRentInvoice(scheduleId: string, input: GeneratePkInvoiceInput) {
  const parsed = generatePkInvoiceSchema.safeParse({ ...input, scheduleId });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("pk_rent_invoice", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const { data: schedule, error: scheduleError } = await supabase
    .schema("rental")
    .from("pk_payment_schedules")
    .select("id, lease_id, due_date, amount, status")
    .eq("id", parsed.data.scheduleId)
    .single();
  if (scheduleError || !schedule) return { error: "Schedule entry not found" };
  if (schedule.status !== "pending") return { error: `This period is already ${schedule.status}` };

  const { data: lease, error: leaseError } = await supabase
    .schema("rental")
    .from("pk_leases")
    .select("currency_id, asset_id, tenant_id")
    .eq("id", schedule.lease_id)
    .single();
  if (leaseError || !lease) return { error: "Lease not found" };

  // Stamp the leased asset's cost centre on every journal line so rental
  // income / receivables attribute to the asset's country (e.g. Pakistan) and
  // show up in country-filtered reports (Trial Balance, Balance Sheet, P&L).
  const costCenterId = lease.asset_id ? await getAssetCostCenterId(lease.asset_id) : null;
  // Debit the tenant's own account so the invoice shows in the tenant's ledger.
  const tenantAccountId = lease.tenant_id ? await getTenantAccountId(companyId, lease.tenant_id) : null;

  const utilityTotal = parsed.data.utilityCharges.reduce((sum, u) => sum + u.amount, 0);
  const advanceAdjusted = parsed.data.advanceAdjusted;
  if (advanceAdjusted > schedule.amount + utilityTotal) {
    return { error: "Advance adjustment cannot exceed the invoice total" };
  }

  const [tenantReceivableId, rentalIncomeId, utilityIncomeId, advanceLiabilityId] = await Promise.all([
    getPostingAccount(companyId, "tenant_receivable"),
    getPostingAccount(companyId, "pk_rental_income"),
    getPostingAccount(companyId, "pk_utility_income"),
    getPostingAccount(companyId, "advance_rent_liability"),
  ]);
  if (!tenantReceivableId || !rentalIncomeId) {
    return {
      error: "Configure Posting Templates for Pakistan Rent Invoice first (Tenant Receivable + Rental Income accounts).",
    };
  }
  if (utilityTotal > 0 && !utilityIncomeId) {
    return { error: "Configure the Utility Recovery Income account in Posting Templates first." };
  }
  if (advanceAdjusted > 0 && !advanceLiabilityId) {
    return { error: "Configure the Advance Rent Liability account in Posting Templates first." };
  }

  const invoiceId = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const netReceivable = schedule.amount + utilityTotal - advanceAdjusted;

  // The tenant's own account is the receivable target; fall back to the shared
  // Tenant Receivable posting account when a tenant has no linked account.
  const receivableAccountId = tenantAccountId ?? tenantReceivableId;

  const lines: EntryLineInput[] = [];
  if (netReceivable > 0) {
    lines.push({ accountId: receivableAccountId, costCenterId, debit: netReceivable, credit: 0, description: "Pakistan rent invoice" });
  }
  if (advanceAdjusted > 0) {
    lines.push({ accountId: advanceLiabilityId!, costCenterId, debit: advanceAdjusted, credit: 0, description: "Advance rent adjusted" });
  }
  lines.push({ accountId: rentalIncomeId, costCenterId, debit: 0, credit: schedule.amount, description: "Pakistan rent invoice" });
  if (utilityTotal > 0) {
    lines.push({ accountId: utilityIncomeId!, costCenterId, debit: 0, credit: utilityTotal, description: "Utility recovery" });
  }

  const je = await createJournalEntry({
    companyId,
    voucherType: "pk_rent_invoice",
    voucherId: invoiceId,
    entryDate: today,
    currencyId: lease.currency_id,
    narration: "Pakistan rent invoice",
    createdBy,
    lines,
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("rental").from("pk_rent_invoices").insert({
    id: invoiceId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    lease_id: schedule.lease_id,
    schedule_id: schedule.id,
    invoice_date: today,
    due_date: schedule.due_date,
    rent_amount: schedule.amount,
    utility_charges: utilityTotal,
    advance_adjusted: advanceAdjusted,
    currency_id: lease.currency_id,
    exchange_rate: je.exchangeRate,
    outstanding_amount: netReceivable,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  if (parsed.data.utilityCharges.length > 0) {
    const { error: utilityError } = await supabase
      .schema("rental")
      .from("pk_utility_charges")
      .insert(
        parsed.data.utilityCharges.map((u) => ({
          invoice_id: invoiceId,
          utility_type: u.utilityType,
          amount: u.amount,
          description: u.description || null,
        })),
      );
    if (utilityError) return { error: utilityError.message };
  }

  revalidatePath(`/rental/pk/leases/${schedule.lease_id}`);
  return { success: true, id: invoiceId };
}

export async function generateAllPkRentInvoices(leaseId: string) {
  await requirePermission("pk_rent_invoice", "create");
  const supabase = await createClient();

  const { data: schedules, error } = await supabase
    .schema("rental")
    .from("pk_payment_schedules")
    .select("id")
    .eq("lease_id", leaseId)
    .eq("status", "pending")
    .order("due_date");
  if (error) return { error: error.message };

  const pending = schedules ?? [];
  if (pending.length === 0) return { error: "No pending periods left to invoice." };

  let generated = 0;
  let firstError: string | undefined;
  for (const s of pending) {
    // Plain rent invoices — no utility charges or advance adjustment; those
    // stay available one-by-one via the per-period dialog.
    const result = await generatePkRentInvoice(s.id, { utilityCharges: [], advanceAdjusted: 0, scheduleId: s.id });
    if ("error" in result) {
      firstError = result.error;
      break;
    }
    generated += 1;
  }

  revalidatePath(`/rental/pk/leases/${leaseId}`);
  if (generated === 0 && firstError) return { error: firstError };
  return { success: true, generated, error: firstError };
}

export async function postAllPkRentInvoices(leaseId: string) {
  await requirePermission("pk_rent_invoice", "post");
  const supabase = await createClient();

  const { data: invoices, error } = await supabase
    .schema("rental")
    .from("pk_rent_invoices")
    .select("id, journal_entry_id, due_date, voucher_no")
    .eq("lease_id", leaseId)
    .order("due_date");
  if (error) return { posted: 0, failed: [{ label: "—", reason: error.message }] };

  const rows = invoices ?? [];

  // Fetch each invoice's posting status separately — journal_entries lives in
  // the accounting schema and PostgREST can't embed it across schemas here.
  const jeIds = rows.map((r) => r.journal_entry_id).filter((v): v is string => Boolean(v));
  const statusById = new Map<string, string>();
  if (jeIds.length > 0) {
    const { data: jes } = await supabase
      .schema("accounting")
      .from("journal_entries")
      .select("id, status")
      .in("id", jeIds);
    for (const je of jes ?? []) statusById.set(je.id, je.status);
  }

  let posted = 0;
  const failed: { label: string; reason: string }[] = [];
  for (const inv of rows) {
    if (inv.journal_entry_id && statusById.get(inv.journal_entry_id) === "posted") continue; // already posted — skip
    const label = inv.voucher_no ?? formatDate(inv.due_date);
    if (!inv.journal_entry_id) {
      failed.push({ label, reason: "Missing journal entry" });
      continue;
    }
    const result = await postPkRentInvoice(inv.id, inv.journal_entry_id);
    if ("error" in result) {
      failed.push({ label, reason: result.error ?? "Failed to post" });
      continue;
    }
    posted += 1;
  }

  revalidatePath(`/rental/pk/leases/${leaseId}`);
  revalidatePath("/rental/pk/invoices");
  return { posted, failed };
}

export async function deletePkRentInvoice(id: string) {
  await requirePermission("pk_rent_invoice", "delete");
  const supabase = await createClient();
  // Definer function removes the draft invoice, its utility charges, its journal
  // entry and reverts the payment schedule to 'pending'; it refuses posted ones.
  const { error } = await supabase.schema("rental").rpc("fn_delete_draft_pk_rent_invoice", { p_id: id });
  if (error) return { error: error.message };

  revalidatePath("/rental/pk/leases");
  return { success: true };
}

export async function postPkRentInvoice(id: string, journalEntryId: string) {
  await requirePermission("pk_rent_invoice", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "pk_rent_invoice", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error } = await supabase
    .schema("rental")
    .from("pk_rent_invoices")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/rental/pk/invoices");
  revalidatePath(`/rental/pk/invoices/${id}`);
  return { success: true, voucherNo: result.voucherNo };
}
