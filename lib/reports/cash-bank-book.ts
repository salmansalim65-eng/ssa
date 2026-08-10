import "server-only";

import { computeRunningBalances } from "@/lib/reports/ledger-balance";
import { createClient } from "@/lib/supabase/server";

export interface CashBankBookLine {
  journal_entry_id: string;
  entry_date: string;
  voucher_no: string | null;
  debit_amount: number;
  credit_amount: number;
  description: string | null;
  narration: string | null;
  balance: number;
}

export interface CashBankAccountSection {
  account_id: string;
  account_code: string;
  account_name: string;
  openingBalance: number;
  rows: CashBankBookLine[];
  closingBalance: number;
}

/** Shared by the Cash Book and Bank Book reports — both are "ledger for every account flagged X, sectioned per account, with a running balance". */
export async function getCashOrBankBookSections(params: {
  companyId: string;
  flag: "is_cash" | "is_bank";
  from: string;
  to: string;
  country?: string;
}): Promise<CashBankAccountSection[]> {
  const supabase = await createClient();

  const { data: accounts } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_code, account_name")
    .eq("company_id", params.companyId)
    .eq(params.flag, true)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("account_code");

  const accountIds = (accounts ?? []).map((a) => a.id);
  if (accountIds.length === 0) return [];

  let priorQuery = supabase
    .schema("reporting")
    .from("v_ledger_entries")
    .select("account_id, debit_amount, credit_amount")
    .eq("company_id", params.companyId)
    .in("account_id", accountIds)
    .lt("entry_date", params.from);
  let periodQuery = supabase
    .schema("reporting")
    .from("v_ledger_entries")
    .select(
      "account_id, journal_entry_id, entry_date, voucher_no, debit_amount, credit_amount, description, narration, line_no",
    )
    .eq("company_id", params.companyId)
    .in("account_id", accountIds)
    .gte("entry_date", params.from)
    .lte("entry_date", params.to);
  if (params.country) {
    priorQuery = priorQuery.eq("cost_center_country", params.country);
    periodQuery = periodQuery.eq("cost_center_country", params.country);
  }

  const [{ data: priorLines }, { data: periodLines }] = await Promise.all([
    priorQuery,
    periodQuery.order("entry_date").order("line_no"),
  ]);

  const openingByAccount = new Map<string, number>();
  for (const l of priorLines ?? []) {
    openingByAccount.set(l.account_id, (openingByAccount.get(l.account_id) ?? 0) + l.debit_amount - l.credit_amount);
  }

  const linesByAccount = new Map<string, NonNullable<typeof periodLines>>();
  for (const l of periodLines ?? []) {
    if (!linesByAccount.has(l.account_id)) linesByAccount.set(l.account_id, []);
    linesByAccount.get(l.account_id)!.push(l);
  }

  return (accounts ?? []).map((a) => {
    const openingBalance = openingByAccount.get(a.id) ?? 0;
    const rows = computeRunningBalances(openingBalance, true, linesByAccount.get(a.id) ?? []);

    return {
      account_id: a.id,
      account_code: a.account_code,
      account_name: a.account_name,
      openingBalance,
      rows,
      closingBalance: rows.length > 0 ? rows[rows.length - 1].balance : openingBalance,
    };
  });
}
