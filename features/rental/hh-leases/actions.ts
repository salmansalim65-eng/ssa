"use server";

import { revalidatePath } from "next/cache";

import { requirePermission, isCurrentUserAdmin } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/rental/tenant-accounts";
import { postUaeRentInvoice } from "@/features/rental/uae-rent-invoices/actions";
import { createJournalEntry, getAccountIdByName, type EntryLineInput } from "@/lib/vouchers/engine";
import { agentRentSplit, HH_AGENT_PCT, UAE_AGENT_PCT } from "@/lib/rental/lease-accounting";
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
// Shared core for the multi-property Rent Invoice grid (HH and UAE). Both post a
// single combined invoice + one journal entry per voucher; they differ only in
// lease_type, agent percentage and the invoice_type badge.
async function createCombinedRentInvoice(
  input: HhLeaseInput,
  opts: {
    leaseType: "standard" | "hh";
    agentPct: number;
    invoiceType: "UAE" | "HH";
    // When re-creating an edited voucher, keep its identity.
    preserveDocumentNo?: string;
    preserveVoucherNo?: string;
  },
) {
  const parsed = hhLeaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // A voucher can never bill the same property twice, so collapse any duplicate
  // asset lines to the first occurrence. This guards against a grid that ends up
  // with a repeated row, which would otherwise create two identical leases and
  // double the invoice amount.
  const inputLines = parsed.data.lines.filter(
    (line, i, all) => all.findIndex((l) => l.assetId === line.assetId) === i,
  );

  await requirePermission("uae_rent_invoice", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  let documentNo: string | null = opts.preserveDocumentNo ?? null;
  if (!documentNo) {
    const { data, error: numberError } = await supabase
      .schema("rental")
      .rpc("fn_next_hh_lease_no", { p_company_id: companyId });
    if (numberError || !data) {
      return { error: numberError?.message ?? "Failed to generate document number" };
    }
    documentNo = data as string;
  }

  const tenantId = await resolveTenantId(companyId, parsed.data.tenantId, createdBy);
  const rows = inputLines.map((line) => ({
    company_id: companyId,
    asset_id: line.assetId,
    tenant_id: tenantId,
    lease_start: line.leaseStart,
    lease_end: line.leaseEnd,
    // The user enters the MONTHLY rent; store it as-is so the month-wise Rent
    // Report shows it per month, and the invoice bills monthly × months.
    rental_amount: round2(Number(line.rentalAmount)),
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
    lease_type: opts.leaseType,
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
    (inputLines[index]?.expenses ?? [])
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
    const line = inputLines[i];
    if (!line) continue;
    // The entered rent is MONTHLY — the invoice bills it for every month of the
    // period (monthly rent × number of months).
    const lineTotal = round2(Number(line.rentalAmount) * monthsBetween(line.leaseStart, line.leaseEnd));
    if (lineTotal <= 0) continue;
    const costCenterId = line.assetId ? await getAssetCostCenterId(line.assetId) : null;
    const { share, income } = agentRentSplit(lineTotal, opts.agentPct);
    const desc = `${opts.invoiceType} rent invoice`;
    lines.push({ accountId: receivableAccountId, costCenterId, debit: lineTotal, credit: 0, description: desc });
    lines.push({ accountId: rentalIncomeId, costCenterId, debit: 0, credit: income, description: desc });
    if (share > 0) {
      lines.push({ accountId: samadRentId, costCenterId, debit: 0, credit: share, description: "Agent share (SAMAD RENT)" });
    }
    for (const e of line.expenses ?? []) {
      const amt = Number(e.amount);
      if (!e.accountId || amt <= 0) continue;
      lines.push({ accountId: e.accountId as string, costCenterId, debit: amt, credit: 0, description: `${opts.invoiceType} lease expense` });
      lines.push({ accountId: receivableAccountId, costCenterId, debit: 0, credit: amt, description: `${opts.invoiceType} lease expense` });
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
      narration: `${opts.invoiceType} rent invoice`,
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
      // Due at the END of the lease period so the whole combined amount is not
      // flagged overdue during the lease — it becomes due when the lease ends.
      due_date: maxEnd ?? invoiceDate,
      period_start: minStart ?? invoiceDate,
      period_end: maxEnd ?? invoiceDate,
      amount: invoiceTotal,
      currency_id: parsed.data.currencyId,
      exchange_rate: je.exchangeRate,
      outstanding_balance: invoiceTotal,
      invoice_type: opts.invoiceType,
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

    // Keep the edited voucher's original number so it stays the same document.
    if (opts.preserveVoucherNo) {
      await supabase
        .schema("rental")
        .from("uae_rent_invoices")
        .update({ voucher_no: opts.preserveVoucherNo })
        .eq("id", invoiceId);
    }
  }

  revalidatePath("/rental/uae/leases");
  revalidatePath("/rental/invoices");
  revalidatePath("/dashboard");
  return { success: true, documentNo: documentNo as string, count: rows.length, invoiceWarning };
}

// HH Rent Invoice: multi-property, 10% agent share, lease_type 'hh'.
export async function createHhLease(input: HhLeaseInput) {
  return createCombinedRentInvoice(input, { leaseType: "hh", agentPct: HH_AGENT_PCT, invoiceType: "HH" });
}

// UAE Rent Invoice: same multi-property grid, 5% agent share, standard lease.
export async function createUaeRentInvoice(input: HhLeaseInput) {
  return createCombinedRentInvoice(input, { leaseType: "standard", agentPct: UAE_AGENT_PCT, invoiceType: "UAE" });
}

// Edit a combined Rent Invoice using the same grid: remove the old voucher
// (invoice + journal entry + its leases) and re-create it from the edited
// values, keeping the same document / voucher number. Admin-only; blocked when
// the invoice has recorded payments.
async function updateCombinedRentInvoice(
  invoiceId: string,
  input: HhLeaseInput,
  opts: { leaseType: "standard" | "hh"; agentPct: number; invoiceType: "UAE" | "HH" },
) {
  const parsed = hhLeaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (!(await isCurrentUserAdmin())) return { error: "Only administrators can edit invoices." };

  const supabase = await createClient();
  const { data: inv } = await supabase
    .schema("rental")
    .from("uae_rent_invoices")
    .select("id, lease_id, voucher_no")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { error: "Invoice not found." };

  const { count: payCount } = await supabase
    .schema("rental")
    .from("uae_rent_payments")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId);
  if ((payCount ?? 0) > 0) {
    return { error: "This invoice has recorded payments. Remove the payments before editing." };
  }

  const { data: firstLease } = await supabase
    .schema("rental")
    .from("uae_leases")
    .select("document_no")
    .eq("id", inv.lease_id)
    .maybeSingle();
  const documentNo = (firstLease?.document_no as string | null) ?? undefined;
  const oldVoucherNo = (inv.voucher_no as string | null) ?? undefined;

  // Remove the old invoice + journal entry (reopens/clears its schedule).
  const { error: delErr } = await supabase
    .schema("rental")
    .rpc("fn_admin_delete_rent_invoice", { p_invoice_id: invoiceId, p_country: "uae" });
  if (delErr) return { error: delErr.message };

  // Soft-delete the old voucher's property leases so they drop out of the lists
  // and reports; the re-create below adds fresh ones under the same document no.
  if (documentNo) {
    const { data: user } = await supabase.auth.getUser();
    const { error: softDeleteErr } = await supabase
      .schema("rental")
      .from("uae_leases")
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.user!.id })
      .eq("document_no", documentNo)
      .is("deleted_at", null);
    // If the old leases can't be cleared, stop — recreating now would leave the
    // old rows behind and double the voucher in the lists and reports.
    if (softDeleteErr) return { error: softDeleteErr.message };
  }

  return createCombinedRentInvoice(input, {
    ...opts,
    preserveDocumentNo: documentNo,
    preserveVoucherNo: oldVoucherNo,
  });
}

export async function updateHhRentInvoice(invoiceId: string, input: HhLeaseInput) {
  return updateCombinedRentInvoice(invoiceId, input, {
    leaseType: "hh",
    agentPct: HH_AGENT_PCT,
    invoiceType: "HH",
  });
}

export async function updateUaeRentInvoice(invoiceId: string, input: HhLeaseInput) {
  return updateCombinedRentInvoice(invoiceId, input, {
    leaseType: "standard",
    agentPct: UAE_AGENT_PCT,
    invoiceType: "UAE",
  });
}
