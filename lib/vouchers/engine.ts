import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ApprovalStatus, VoucherType } from "@/types/database.types";

export interface EntryLineInput {
  accountId: string;
  costCenterId?: string | null;
  debit: number;
  credit: number;
  description?: string | null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
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
}): Promise<{ journalEntryId: string } | { error: string }> {
  const supabase = await createClient();
  const exchangeRate = await resolveExchangeRate(params.companyId, params.currencyId, params.entryDate);

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
  }));

  const { error: linesError } = await supabase
    .schema("accounting")
    .from("journal_entry_lines")
    .insert(lineRows);

  if (linesError) return { error: linesError.message };

  return { journalEntryId: je.id as string };
}

async function syncJournalEntryStatus(journalEntryId: string, status: ApprovalStatus) {
  const supabase = await createClient();
  const { error } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({ status })
    .eq("id", journalEntryId);

  return error ? { error: error.message } : { error: null };
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

  const sync = await syncJournalEntryStatus(params.journalEntryId, approval.status);
  if (sync.error) return { error: sync.error };

  return { approval };
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

  const sync = await syncJournalEntryStatus(params.journalEntryId, approval.status);
  if (sync.error) return { error: sync.error };

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

  const { error: postError } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .update({ status: "posted" })
    .eq("id", params.journalEntryId);

  if (postError) return { error: postError.message };

  return { voucherNo: voucherNo as string };
}
