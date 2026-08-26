"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/rental/tenant-accounts";
import { postUaeRentInvoice } from "@/features/rental/uae-rent-invoices/actions";
import { createJournalEntry, getAccountIdByName, type EntryLineInput } from "@/lib/vouchers/engine";
import { agentRentSplit, HH_AGENT_PCT } from "@/lib/rental/lease-accounting";
import { hhLeaseSchema, type HhLeaseInput } from "./schemas";

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

// Whole calendar months a lease period spans, inclusive (2026-08 → 2027-01 = 6).
function monthsBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const n = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
  return Math.max(1, n);
}

async function getPostingAccount(companyId: string, accountRole: string) {
  const supabase = await createClient();
  const { data } = await supabase.schema("accounting").rpc("fn_get_posting_account", {
    p_company_id: companyId,
    p_voucher_type: "uae_rent_invoice",
    p_account_role: accountRole,
  });
  return data as string | null;
}

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

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

/**
 * HH Lease voucher: one tenant + one document header, many asset lines. Each
 * line becomes its own rental.uae_leases row (and therefore gets its own
 * auto-generated payment schedule), all stamped with the shared document
 * number so the voucher can be recognised later.
 */
export async function createHhLease(input: HhLeaseInput) {
  const parsed = hhLeaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("uae_rent_invoice", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const { data: documentNo, error: numberError } = await supabase
    .schema("rental")
    .rpc("fn_next_hh_lease_no", { p_company_id: companyId });
  if (numberError || !documentNo) {
    return { error: numberError?.message ?? "Failed to generate document number" };
  }

  const tenantId = await resolveTenantId(companyId, parsed.data.tenantId, createdBy);
  const rows = parsed.data.lines.map((line) => ({
    company_id: companyId,
    asset_id: line.assetId,
    tenant_id: tenantId,
    lease_start: line.leaseStart,
    lease_end: line.leaseEnd,
    rental_amount: line.rentalAmount,
    rent_cycle: parsed.data.rentCycle,
    security_deposit: 0,
    currency_id: parsed.data.currencyId,
    rent_month: null,
    // Named expenses now live in rental.lease_expenses; the legacy single-amount
    // column stays 0 for HH leases created this way.
    expense_amount: 0,
    remarks: line.remarks || null,
    document_no: documentNo as string,
    document_date: parsed.data.documentDate,
    lease_type: "hh",
    created_by: createdBy,
  }));

  const { data: createdLeases, error } = await supabase
    .schema("rental")
    .from("uae_leases")
    .insert(rows)
    .select("id");
  if (error) return { error: error.message };

  // Persist each property's monthly expenses (an expense account + amount),
  // dropping blank rows. Each created lease line lines up with
  // parsed.data.lines by index. These post Dr account / Cr tenant when the HH
  // invoice is generated.
  const expenseRows = (createdLeases ?? []).flatMap((lease, index) =>
    (parsed.data.lines[index]?.expenses ?? [])
      .filter((e) => (e.accountId ?? "") !== "" && Number(e.amount) > 0)
      .map((e) => ({
        company_id: companyId,
        lease_id: lease.id,
        account_id: e.accountId as string,
        amount: Number(e.amount),
      })),
  );
  if (expenseRows.length) {
    const { error: expErr } = await supabase.schema("rental").from("lease_expenses").insert(expenseRows);
    if (expErr) return { error: expErr.message };
  }

  // ONE combined invoice + ONE journal entry for the whole HH voucher. Each
  // property books its rent (monthly rent × months in its period) with its own
  // cost centre, its agent share, and any HH expenses — all summed into a single
  // posting so the ledger shows one entry per voucher. The leases above (and
  // their monthly schedules) still exist so the month-wise Rent Report keeps
  // working; those schedules are flagged 'invoiced' here so they aren't billed
  // again.
  const created = createdLeases ?? [];
  const [tenantReceivableId, rentalIncomeId, samadRentId] = await Promise.all([
    getPostingAccount(companyId, "tenant_receivable"),
    getPostingAccount(companyId, "uae_rental_income"),
    getAccountIdByName(companyId, "SAMAD RENT"),
  ]);
  if (!tenantReceivableId || !rentalIncomeId) {
    return { error: "Configure Posting Templates for UAE Rent Invoice first (Tenant Receivable + Rental Income accounts)." };
  }
  if (!samadRentId) {
    return { error: 'The "SAMAD RENT" account is missing from the Chart of Accounts; cannot post the agent share.' };
  }
  const tenantAccountId = await getTenantAccountId(companyId, tenantId);
  const receivableAccountId = tenantAccountId ?? tenantReceivableId;

  const invoiceId = crypto.randomUUID();
  const invoiceDate = parsed.data.documentDate;
  const lines: EntryLineInput[] = [];
  let invoiceTotal = 0;
  let minStart: string | null = null;
  let maxEnd: string | null = null;

  for (let i = 0; i < created.length; i++) {
    const line = parsed.data.lines[i];
    if (!line) continue;
    const months = monthsBetween(line.leaseStart, line.leaseEnd);
    const lineTotal = round2(Number(line.rentalAmount) * months);
    if (lineTotal <= 0) continue;
    const costCenterId = line.assetId ? await getAssetCostCenterId(line.assetId) : null;
    const { share, income } = agentRentSplit(lineTotal, HH_AGENT_PCT);
    lines.push({ accountId: receivableAccountId, costCenterId, debit: lineTotal, credit: 0, description: "HH rent invoice" });
    lines.push({ accountId: rentalIncomeId, costCenterId, debit: 0, credit: income, description: "HH rent invoice" });
    if (share > 0) {
      lines.push({ accountId: samadRentId, costCenterId, debit: 0, credit: share, description: "Agent share (SAMAD RENT)" });
    }
    for (const e of line.expenses ?? []) {
      const amt = Number(e.amount);
      if (!e.accountId || amt <= 0) continue;
      lines.push({ accountId: e.accountId as string, costCenterId, debit: amt, credit: 0, description: "HH lease expense" });
      lines.push({ accountId: receivableAccountId, costCenterId, debit: 0, credit: amt, description: "HH lease expense" });
    }
    invoiceTotal = round2(invoiceTotal + lineTotal);
    if (!minStart || line.leaseStart < minStart) minStart = line.leaseStart;
    if (!maxEnd || line.leaseEnd > maxEnd) maxEnd = line.leaseEnd;
  }

  let invoiceWarning: string | undefined;
  if (lines.length > 0 && invoiceTotal > 0 && created[0]) {
    const je = await createJournalEntry({
      companyId,
      voucherType: "uae_rent_invoice",
      voucherId: invoiceId,
      entryDate: invoiceDate,
      currencyId: parsed.data.currencyId,
      narration: "HH rent invoice",
      createdBy,
      lines,
    });
    if ("error" in je) return { error: je.error };

    const { error: invErr } = await supabase.schema("rental").from("uae_rent_invoices").insert({
      id: invoiceId,
      company_id: companyId,
      journal_entry_id: je.journalEntryId,
      lease_id: created[0].id,
      schedule_id: null,
      invoice_date: invoiceDate,
      due_date: maxEnd ?? invoiceDate,
      period_start: minStart ?? invoiceDate,
      period_end: maxEnd ?? invoiceDate,
      amount: invoiceTotal,
      currency_id: parsed.data.currencyId,
      exchange_rate: je.exchangeRate,
      outstanding_balance: invoiceTotal,
      invoice_type: "HH",
      created_by: createdBy,
    });
    if (invErr) return { error: invErr.message };

    await supabase
      .schema("rental")
      .from("uae_payment_schedules")
      .update({ status: "invoiced" })
      .in(
        "lease_id",
        created.map((l) => l.id),
      )
      .eq("status", "pending");

    const post = await postUaeRentInvoice(invoiceId, je.journalEntryId);
    if ("error" in post) invoiceWarning = post.error;
  }

  revalidatePath("/rental/uae/leases");
  revalidatePath("/rental/invoices");
  revalidatePath("/dashboard");
  return { success: true, documentNo: documentNo as string, count: rows.length, invoiceWarning };
}
