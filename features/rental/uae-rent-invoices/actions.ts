"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher } from "@/lib/vouchers/engine";

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

function addPeriod(date: string, cycle: "monthly" | "yearly") {
  const d = new Date(date);
  if (cycle === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function generateUaeRentInvoice(scheduleId: string) {
  await requirePermission("uae_rent_invoice", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const { data: schedule, error: scheduleError } = await supabase
    .schema("rental")
    .from("uae_payment_schedules")
    .select("id, lease_id, due_date, amount, status")
    .eq("id", scheduleId)
    .single();
  if (scheduleError || !schedule) return { error: "Schedule entry not found" };
  if (schedule.status !== "pending") return { error: `This period is already ${schedule.status}` };

  const { data: lease, error: leaseError } = await supabase
    .schema("rental")
    .from("uae_leases")
    .select("currency_id, rent_cycle")
    .eq("id", schedule.lease_id)
    .single();
  if (leaseError || !lease) return { error: "Lease not found" };

  const [tenantReceivableId, rentalIncomeId] = await Promise.all([
    getPostingAccount(companyId, "tenant_receivable"),
    getPostingAccount(companyId, "uae_rental_income"),
  ]);
  if (!tenantReceivableId || !rentalIncomeId) {
    return { error: "Configure Posting Templates for UAE Rent Invoice first (Tenant Receivable + Rental Income accounts)." };
  }

  const invoiceId = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const periodEnd = addPeriod(schedule.due_date, lease.rent_cycle);

  const je = await createJournalEntry({
    companyId,
    voucherType: "uae_rent_invoice",
    voucherId: invoiceId,
    entryDate: today,
    currencyId: lease.currency_id,
    narration: "UAE rent invoice",
    createdBy,
    lines: [
      { accountId: tenantReceivableId, debit: schedule.amount, credit: 0, description: "UAE rent invoice" },
      { accountId: rentalIncomeId, debit: 0, credit: schedule.amount, description: "UAE rent invoice" },
    ],
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("rental").from("uae_rent_invoices").insert({
    id: invoiceId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    lease_id: schedule.lease_id,
    schedule_id: schedule.id,
    invoice_date: today,
    due_date: schedule.due_date,
    period_start: schedule.due_date,
    period_end: periodEnd,
    amount: schedule.amount,
    currency_id: lease.currency_id,
    exchange_rate: je.exchangeRate,
    outstanding_balance: schedule.amount,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  revalidatePath(`/rental/uae/leases/${schedule.lease_id}`);
  return { success: true, id: invoiceId };
}

export async function generateAllUaeRentInvoices(leaseId: string) {
  await requirePermission("uae_rent_invoice", "create");
  const supabase = await createClient();

  const { data: schedules, error } = await supabase
    .schema("rental")
    .from("uae_payment_schedules")
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
    const result = await generateUaeRentInvoice(s.id);
    if ("error" in result) {
      // A failure here (e.g. missing posting template) applies to every
      // remaining period too, so stop rather than repeat the same error.
      firstError = result.error;
      break;
    }
    generated += 1;
  }

  revalidatePath(`/rental/uae/leases/${leaseId}`);
  if (generated === 0 && firstError) return { error: firstError };
  return { success: true, generated, error: firstError };
}

export async function postAllUaeRentInvoices(leaseId: string) {
  await requirePermission("uae_rent_invoice", "post");
  const supabase = await createClient();

  const { data: invoices, error } = await supabase
    .schema("rental")
    .from("uae_rent_invoices")
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
    const result = await postUaeRentInvoice(inv.id, inv.journal_entry_id);
    if ("error" in result) {
      failed.push({ label, reason: result.error ?? "Failed to post" });
      continue;
    }
    posted += 1;
  }

  revalidatePath(`/rental/uae/leases/${leaseId}`);
  revalidatePath("/rental/uae/invoices");
  return { posted, failed };
}

export async function deleteUaeRentInvoice(id: string) {
  await requirePermission("uae_rent_invoice", "delete");
  const supabase = await createClient();
  // Definer function removes the draft invoice, its journal entry and reverts
  // the payment schedule to 'pending'; it refuses anything already posted.
  const { error } = await supabase.schema("rental").rpc("fn_delete_draft_uae_rent_invoice", { p_id: id });
  if (error) return { error: error.message };

  revalidatePath("/rental/uae/leases");
  return { success: true };
}

export async function postUaeRentInvoice(id: string, journalEntryId: string) {
  await requirePermission("uae_rent_invoice", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "uae_rent_invoice", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error } = await supabase
    .schema("rental")
    .from("uae_rent_invoices")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/rental/uae/invoices");
  revalidatePath(`/rental/uae/invoices/${id}`);
  return { success: true, voucherNo: result.voucherNo };
}
