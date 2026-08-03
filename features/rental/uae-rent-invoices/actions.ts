"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
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
