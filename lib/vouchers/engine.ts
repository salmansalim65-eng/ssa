import "server-only";

import { cache } from "react";
import { revalidatePath } from "next/cache";

import { hasPermission, isCurrentUserAdmin } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/format";
import { approverUserIds, sendPushToUsers } from "@/lib/notifications/push";
import { createClient } from "@/lib/supabase/server";
import type { VoucherType } from "@/types/database.types";

export interface EntryLineInput {
  accountId: string;
  costCenterId?: string | null;
  debit: number;
  credit: number;
  description?: string | null;
  reference?: string | null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Cached per request: many actions/pages resolve the company id, and it never
// changes within a single request, so this collapses those to one RPC.
export const getCurrentCompanyId = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
});

/**
 * Resolves a posting account by its Chart-of-Accounts name (case-insensitive,
 * leaf accounts only) within a company. Used where an account is identified by
 * a well-known business name (e.g. "SAMAD RENT") rather than a posting-template
 * role, so IDs are never hard-coded. Returns null when it can't be found.
 */
export async function getAccountIdByName(companyId: string, accountName: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_group", false)
    .is("deleted_at", null)
    .ilike("account_name", accountName)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function getVoucherApproval(voucherType: VoucherType, voucherId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounting")
    .from("voucher_approvals")
    .select("id, status, current_step, amount")
    .eq("voucher_type", voucherType)
    .eq("voucher_id", voucherId)
    .maybeSingle();

  return data;
}

/** Resolves today's (or entry-date's) rate from core.exchange_rates rather than trusting a client-supplied number. */
export async function resolveExchangeRate(companyId: string, currencyId: string, asOfDate: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("core")
    .rpc("fn_exchange_rate_to_base", {
      p_company_id: companyId,
      p_currency_id: currencyId,
      p_as_of_date: asOfDate,
    });

  if (error) throw new Error(error.message);
  return data as number;
}

/**
 * Creates the journal_entries header + journal_entry_lines for a new
 * voucher. All lines share the header's currency/exchange rate — Phase 5's
 * vouchers are single-currency; a JV that genuinely needs to mix
 * currencies across lines is a future extension, not something callers
 * need to plan for today.
 */
export async function createJournalEntry(params: {
  companyId: string;
  voucherType: VoucherType;
  voucherId: string;
  entryDate: string;
  currencyId: string;
  narration?: string | null;
  createdBy: string;
  lines: EntryLineInput[];
  /**
   * Explicit conversion rate to base. When provided (and positive) it is used
   * as-is — the caller collected it on the form (seeded from the exchange-rate
   * table, then possibly adjusted). Omitted, the rate is resolved server-side.
   */
  exchangeRate?: number;
}): Promise<{ journalEntryId: string; exchangeRate: number } | { error: string }> {
  const supabase = await createClient();
  const exchangeRate =
    params.exchangeRate && params.exchangeRate > 0
      ? params.exchangeRate
      : await resolveExchangeRate(params.companyId, params.currencyId, params.entryDate);

  const { data: je, error: jeError } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .insert({
      company_id: params.companyId,
      entry_date: params.entryDate,
      voucher_type: params.voucherType,
      voucher_id: params.voucherId,
      currency_id: params.currencyId,
      exchange_rate: exchangeRate,
      narration: params.narration ?? null,
      created_by: params.createdBy,
    })
    .select("id")
    .single();

  if (jeError || !je) return { error: jeError?.message ?? "Failed to create journal entry" };

  const lineRows = params.lines.map((line, index) => ({
    journal_entry_id: je.id,
    line_no: index + 1,
    account_id: line.accountId,
    cost_center_id: line.costCenterId ?? null,
    debit_amount: line.debit,
    credit_amount: line.credit,
    currency_id: params.currencyId,
    exchange_rate: exchangeRate,
    base_debit_amount: round2(line.debit * exchangeRate),
    base_credit_amount: round2(line.credit * exchangeRate),
    description: line.description ?? null,
    reference: line.reference ?? null,
  }));

  const { error: linesError } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .insert(lineRows);

  if (linesError) return { error: linesError.message };

  return { journalEntryId: je.id as string, exchangeRate };
}

export async function submitForApproval(params: {
  companyId: string;
  voucherType: VoucherType;
  voucherId: string;
  journalEntryId: string;
  amount: number;
}) {
  const supabase = await createClient();
  const { data: approval, error } = await supabase.schema("accounting").rpc("fn_start_approval", {
    p_company_id: params.companyId,
    p_voucher_type: params.voucherType,
    p_voucher_id: params.voucherId,
    p_amount: params.amount,
  });

  if (error || !approval) return { error: error?.message ?? "Failed to submit for approval" };

  // fn_start_approval moves the journal entry to the same status in the same
  // transaction (0119). It used to be a second update from here, which ran as
  // the user: a clerk holding only view + create could not update
  // journal_entries, the update matched no rows — which is not an error — and
  // the voucher was left showing as a draft while the approval said pending.
  if (approval.status === "pending") await notifyApprovers(params);

  return { approval };
}

/**
 * Tells everyone who may approve this voucher that it is waiting — as a phone
 * notification, so it lands whether or not the app is open. Never allowed to
 * fail the submission: a voucher that reached the approver's queue is submitted
 * whether or not the alert got out.
 */
async function notifyApprovers(params: {
  companyId: string;
  voucherType: VoucherType;
  voucherId: string;
  amount: number;
}) {
  try {
    const supabase = await createClient();
    const { data: user } = await supabase.auth.getUser();
    // Whoever submitted it does not need telling.
    const recipients = await approverUserIds(params.companyId, params.voucherType, user.user?.id);
    if (!recipients.length) return;

    const { VOUCHER_TYPE_LABELS, voucherHref } = await import("./meta");
    await sendPushToUsers(recipients, {
      title: "Approval needed",
      body: `${VOUCHER_TYPE_LABELS[params.voucherType]} — ${formatMoney(params.amount)}`,
      url: voucherHref(params.voucherType, params.voucherId),
      // One notification per voucher, replaced rather than stacked.
      tag: `approval-${params.voucherId}`,
    });
  } catch {
    // Best-effort: the bell and the pending list still show it.
  }
}

/** The document-currency debit total of an entry — the figure the approval
 *  workflow's rules are matched against. */
async function journalEntryAmount(journalEntryId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .select("debit_amount")
    .eq("journal_entry_id", journalEntryId);
  return (data ?? []).reduce((sum, l) => sum + Number(l.debit_amount ?? 0), 0);
}

/**
 * What happens the moment a voucher is created. An administrator's voucher
 * posts straight away; everyone else's goes to the approver by itself, so no
 * one has to remember to press "Submit for approval".
 *
 * Best-effort on purpose: a voucher that could not be routed is still saved as
 * a draft, and its detail screen still offers the manual button — which is why
 * that button now only appears when this did not get there first.
 */
export async function routeNewVoucher(params: {
  companyId: string;
  voucherType: VoucherType;
  voucherId: string;
  journalEntryId: string;
  post: () => Promise<unknown>;
}) {
  try {
    if (await isCurrentUserAdmin()) {
      await params.post();
      return;
    }
    const result = await submitForApproval({
      companyId: params.companyId,
      voucherType: params.voucherType,
      voucherId: params.voucherId,
      journalEntryId: params.journalEntryId,
      amount: await journalEntryAmount(params.journalEntryId),
    });
    // A voucher type with no active approval workflow comes straight back as
    // "approved" (fn_start_approval says so itself). Approved means posted, so
    // finish the job rather than leaving it parked with nobody to approve it.
    if (!("error" in result) && result.approval?.status === "approved") await params.post();
  } catch {
    // The voucher is saved either way; the draft can be routed by hand.
  }
}

/**
 * The statuses a voucher can still be edited in. Nothing has reached the ledger
 * yet: a draft was never sent, a pending one is with the approver, and a
 * SENT BACK one is with its creator precisely so it can be corrected.
 */
export const EDITABLE_STATUSES: readonly string[] = ["draft", "pending", "sent_back"];

/**
 * Voucher types that stay editable once POSTED. A posted journal entry cannot be
 * changed, so each of these reverses the posted voucher and re-creates it from
 * the edited values — which their update actions do, and only for an admin.
 *
 * Opening balances are corrections to the opening figures; receipts and
 * payments are the two sides of the same settlement and are corrected the same
 * way. Every other type is final once posted.
 */
export const EDITABLE_WHEN_POSTED: readonly string[] = [
  "opening_balance_voucher",
  "receipt_voucher",
  "payment_voucher",
];

/**
 * Whether the current user may edit this voucher, as an error message or null.
 *
 * The Edit permission allows it for any voucher. Without it, someone may still
 * edit their OWN voucher while it is unposted — which is what makes "send back"
 * mean anything for a data-entry clerk, who holds view + create and would
 * otherwise have no way to act on a voucher returned to them.
 */
export async function canEditVoucher(
  voucherType: VoucherType,
  entry: { status: string; created_by?: string | null },
) {
  if (await hasPermission(voucherType, "edit")) return true;

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const isOwnVoucher = Boolean(entry.created_by) && user.user?.id === entry.created_by;
  return isOwnVoucher && EDITABLE_STATUSES.includes(entry.status);
}

/** The same rule as canEditVoucher, as an error message for a server action. */
export async function ensureCanEditVoucher(
  voucherType: VoucherType,
  entry: { status: string; created_by?: string | null },
) {
  if (await canEditVoucher(voucherType, entry)) return null;
  return `Not permitted: ${voucherType}.edit`;
}

/**
 * An edited voucher goes back through approval. The workflow step is picked by
 * amount, so a changed amount has to re-pick it, and a sent-back voucher is
 * edited exactly so it can return to the approver. A draft is left alone — it
 * was never submitted.
 *
 * Best-effort, like the routing on creation: the edit itself has already been
 * saved, and the voucher keeps the status it had.
 */
export async function resubmitEditedVoucher(params: {
  companyId: string;
  voucherType: VoucherType;
  voucherId: string;
  journalEntryId: string;
  previousStatus: string;
}) {
  if (params.previousStatus !== "pending" && params.previousStatus !== "sent_back") return;
  try {
    await submitForApproval({
      companyId: params.companyId,
      voucherType: params.voucherType,
      voucherId: params.voucherId,
      journalEntryId: params.journalEntryId,
      amount: await journalEntryAmount(params.journalEntryId),
    });
  } catch {
    // The voucher keeps its current status; it can be resubmitted by hand.
  }
}

export async function actOnApproval(params: {
  voucherApprovalId: string;
  journalEntryId: string;
  action: "approve" | "reject" | "send_back";
  comment?: string;
}) {
  const supabase = await createClient();
  const { data: approval, error } = await supabase.schema("accounting").rpc("fn_approval_action", {
    p_voucher_approval_id: params.voucherApprovalId,
    p_action: params.action,
    p_comment: params.comment,
  });

  if (error || !approval) return { error: error?.message ?? "Failed to record decision" };

  // fn_approval_action moves the journal entry with the decision (see above).
  return { approval };
}

/** Assigns the document number and flips the journal entry to 'posted'; the balance/permission trigger does the real validation. */
export async function postVoucher(params: {
  companyId: string;
  voucherType: VoucherType;
  journalEntryId: string;
}): Promise<{ voucherNo: string } | { error: string }> {
  const supabase = await createClient();

  const { data: voucherNo, error: numberError } = await supabase
    .schema("core")
    .rpc("fn_next_document_number", { p_company_id: params.companyId, p_voucher_type: params.voucherType });

  if (numberError || !voucherNo) {
    return { error: numberError?.message ?? "Failed to generate document number" };
  }

  // A foreign-currency account settled at a rate other than the one it was
  // raised at leaves a residue in base currency. That is a realised exchange
  // gain or loss, so it is written off to the Exchange Gain/Loss account as part
  // of THIS entry — while its lines can still be written, i.e. before the status
  // flips. Best-effort: with no such account configured the function does
  // nothing, and a failure here must not block a voucher from posting.
  await supabase
    .schema("accounting")
    .rpc("fn_realise_exchange_difference", { p_journal_entry_id: params.journalEntryId });

  const { error: postError } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({ status: "posted" })
    .eq("id", params.journalEntryId);

  if (postError) return { error: postError.message };

  // Every posted entry changes the dashboard figures, so invalidate its cache
  // here (one place all vouchers pass through) — the dashboard then shows fresh
  // numbers on the next visit without a manual reload.
  try {
    revalidatePath("/dashboard");
  } catch {
    // revalidatePath is a no-op outside a request context (e.g. tests).
  }

  return { voucherNo: voucherNo as string };
}
