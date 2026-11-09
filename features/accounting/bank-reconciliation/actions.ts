"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import type { BankStatementLine } from "@/lib/accounting/bank-statement";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** How many days apart a bank line and a ledger line may still be the same payment. */
const DAY_WINDOW = 5;

export interface MatchedRow {
  line: BankStatementLine;
  voucherNo: string | null;
  voucherType: string | null;
  entryDate: string;
  narration: string | null;
  /** Days between the bank's date and ours — 0 when they agree. */
  daysApart: number;
}

export interface LedgerOnlyRow {
  voucherNo: string | null;
  voucherType: string | null;
  entryDate: string;
  narration: string | null;
  debit: number;
  credit: number;
}

export interface ReconcileResult {
  /** On the statement and in SSA. */
  matched: MatchedRow[];
  /** On the statement, nowhere in SSA — the ones that were never entered. */
  missing: BankStatementLine[];
  /** In SSA, not on the statement — an uncleared cheque, or the wrong month. */
  unseen: LedgerOnlyRow[];
  from: string;
  to: string;
}

/**
 * Hold a bank statement against the ledger and say what is not in the books.
 *
 * Small payments go out and nobody enters them. They are not missing from the
 * bank, only from SSA, and a month later nobody can remember what they were.
 * The bank already has the list; this reads it back against what SSA has and
 * says which lines have no entry behind them.
 *
 * A line matches a ledger entry when the money is the SAME, on the SAME side,
 * within a few days. Amount is the hard test and date is the soft one: a bank
 * posts on its own clock, and a transfer entered on the 3rd may clear on the
 * 5th. The closest date wins, and each ledger entry can answer for one bank
 * line only — two payments of 575 are two entries, not one entry matched twice.
 *
 * Nothing is written. It reads, compares and reports; entering what is missing
 * is a separate, deliberate act.
 */
export async function reconcileBankStatement(
  accountId: string,
  lines: BankStatementLine[],
): Promise<ReconcileResult | { error: string }> {
  await requirePermission("reports", "view");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const dated = lines.filter((l) => l.date);
  if (dated.length === 0) return { error: "That statement has no dated lines to match." };

  const dates = dated.map((l) => l.date).sort();
  const from = shiftDays(dates[0], -DAY_WINDOW);
  const to = shiftDays(dates[dates.length - 1], DAY_WINDOW);

  const { data: ledgerRows, error } = await supabase
    .schema("reporting")
    .from("v_ledger_entries")
    .select("journal_entry_id, line_no, entry_date, voucher_no, voucher_type, narration, description, doc_debit_amount, doc_credit_amount")
    .eq("company_id", companyId)
    .eq("account_id", accountId)
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date");
  if (error) return { error: error.message };

  type Row = {
    journal_entry_id: string;
    line_no: number;
    entry_date: string;
    voucher_no: string | null;
    voucher_type: string | null;
    narration: string | null;
    description: string | null;
    doc_debit_amount: number;
    doc_credit_amount: number;
  };
  const ledger = ((ledgerRows ?? []) as Row[]).map((r, i) => ({ ...r, key: `${r.journal_entry_id}:${r.line_no}:${i}` }));
  const taken = new Set<string>();

  const matched: MatchedRow[] = [];
  const missing: BankStatementLine[] = [];

  for (const line of dated) {
    // Money OUT of the bank is a CREDIT on the bank's ledger account, and money
    // in is a debit. The statement is written from the bank's side; the ledger
    // from ours.
    const wantCredit = round2(line.debit);
    const wantDebit = round2(line.credit);

    const candidates = ledger
      .filter((r) => !taken.has(r.key))
      .filter((r) =>
        wantCredit > 0
          ? round2(Number(r.doc_credit_amount)) === wantCredit
          : round2(Number(r.doc_debit_amount)) === wantDebit,
      )
      .map((r) => ({ row: r, daysApart: Math.abs(daysBetween(line.date, r.entry_date)) }))
      .filter((c) => c.daysApart <= DAY_WINDOW)
      .sort((a, b) => a.daysApart - b.daysApart);

    const hit = candidates[0];
    if (!hit) {
      missing.push(line);
      continue;
    }
    taken.add(hit.row.key);
    matched.push({
      line,
      voucherNo: hit.row.voucher_no,
      voucherType: hit.row.voucher_type,
      entryDate: hit.row.entry_date,
      narration: hit.row.narration ?? hit.row.description,
      daysApart: hit.daysApart,
    });
  }

  // What is in SSA and not on the statement. Clipped to the statement's own
  // dates — a window wider than the statement would call every later payment
  // "unseen" when the bank simply has not reached it.
  const unseen: LedgerOnlyRow[] = ledger
    .filter((r) => !taken.has(r.key))
    .filter((r) => r.entry_date >= dates[0] && r.entry_date <= dates[dates.length - 1])
    .map((r) => ({
      voucherNo: r.voucher_no,
      voucherType: r.voucher_type,
      entryDate: r.entry_date,
      narration: r.narration ?? r.description,
      debit: Number(r.doc_debit_amount),
      credit: Number(r.doc_credit_amount),
    }));

  return { matched, missing, unseen, from: dates[0], to: dates[dates.length - 1] };
}

const DAY_MS = 86_400_000;
function utc(date: string) {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}
function daysBetween(a: string, b: string) {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}
function shiftDays(date: string, days: number) {
  return new Date(utc(date) + days * DAY_MS).toISOString().slice(0, 10);
}
