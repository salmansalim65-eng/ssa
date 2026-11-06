"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, type EntryLineInput } from "@/lib/vouchers/engine";
import { monthStart, rentMonthLabel, rentMonthsOf, splitOverMonths } from "@/lib/rental/rent-months";
import { rentStatementSchema, type RentStatementInput } from "./schemas";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The accounts a statement posts to, by the role each column plays.
 *
 * Read from `accounting.posting_templates`, the same table the rent invoices
 * use, rather than written into this file. Which account DEWA belongs to is a
 * decision for whoever keeps the chart of accounts, and a hard-coded one is a
 * decision nobody can see or change.
 */
const ROLES = {
  income: "uae_rental_income",
  unearned: "unearned_rent_income",
  dewa: "dewa",
  internet: "internet",
  accessCard: "access_card",
  wifi: "wifi",
  other: "other_rental_expense",
} as const;

async function postingAccounts(companyId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounting")
    .from("posting_templates")
    .select("account_role, account_id")
    .eq("company_id", companyId)
    .in("voucher_type", ["rent_statement", "uae_rent_invoice"]);

  // A role set for the statement wins over the one inherited from the rent
  // invoice, so the two can differ without the invoice's being re-pointed.
  const byRole = new Map<string, string>();
  for (const r of (data ?? []) as { account_role: string; account_id: string }[]) {
    if (!byRole.has(r.account_role)) byRole.set(r.account_role, r.account_id);
  }
  return byRole;
}

/**
 * Save a statement.
 *
 * Short-term lines are the company's own income, recognised in the month each
 * line's rent belongs to: anything for a month already reached is income now,
 * and anything for a month still ahead waits in Unearned rent income until
 * that month comes round. Never apportioned by day — a line belongs to a month.
 *
 * Long-term lines post NOTHING. Those units are invoiced monthly from their
 * lease already; the line is carried so the voucher's total is the sheet's
 * total, and so the two can be seen to agree.
 *
 * The entry is left as a draft. Posting is a separate step, so a statement can
 * be entered, read back against the paper, and only then committed.
 */
export async function createRentStatement(input: RentStatementInput) {
  const parsed = rentStatementSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const data = parsed.data;

  await requirePermission("rent_statement", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const roles = await postingAccounts(companyId);
  const missing: string[] = [];
  const accountFor = (role: string, label: string) => {
    const id = roles.get(role);
    if (!id) missing.push(label);
    return id ?? "";
  };

  const shortTerm = data.lines.filter((l) => l.lineType === "short_term");

  // What the agent owes: every line's net, long-term included, because that is
  // what the sheet's bottom line says and what will be paid.
  const totals = data.lines.reduce(
    (t, l) => {
      const deductions = l.dewa + l.internet + l.accessCard + l.wifi + l.other;
      t.rent += l.rentAmount;
      t.management += l.managementAmount;
      t.deductions += deductions;
      t.net += l.rentAmount - l.managementAmount - deductions;
      return t;
    },
    { rent: 0, management: 0, deductions: 0, net: 0 },
  );

  // Income, split by the month each line's rent belongs to. The month the
  // statement is for divides "earned" from "not yet".
  let earned = 0;
  let unearned = 0;
  for (const l of shortTerm) {
    const netRent = round2(l.rentAmount - l.managementAmount);
    const months = rentMonthsOf(l.rentMonth, l.months);
    const parts = splitOverMonths(netRent, l.months);
    months.forEach((m, i) => {
      if (m <= data.statementMonth) earned += parts[i];
      else unearned += parts[i];
    });
  }
  earned = round2(earned);
  unearned = round2(unearned);

  const deductionTotals = shortTerm.reduce(
    (t, l) => {
      t.dewa += l.dewa;
      t.internet += l.internet;
      t.accessCard += l.accessCard;
      t.wifi += l.wifi;
      t.other += l.other;
      return t;
    },
    { dewa: 0, internet: 0, accessCard: 0, wifi: 0, other: 0 },
  );

  // Long-term lines are already invoiced; only the short-term side reaches the
  // ledger, and the agent is debited for what that side leaves them owing.
  const shortTermNet = round2(
    shortTerm.reduce(
      (s, l) => s + l.rentAmount - l.managementAmount - (l.dewa + l.internet + l.accessCard + l.wifi + l.other),
      0,
    ),
  );

  const lines: EntryLineInput[] = [];
  if (shortTermNet !== 0) {
    lines.push({
      accountId: data.agentAccountId,
      debit: shortTermNet,
      credit: 0,
      description: "Rent statement",
    });
  }
  const deduction = (amount: number, role: string, label: string) => {
    if (round2(amount) === 0) return;
    lines.push({ accountId: accountFor(role, label), debit: round2(amount), credit: 0, description: label });
  };
  deduction(deductionTotals.dewa, ROLES.dewa, "DEWA");
  deduction(deductionTotals.internet, ROLES.internet, "Internet");
  deduction(deductionTotals.accessCard, ROLES.accessCard, "Access card");
  deduction(deductionTotals.wifi, ROLES.wifi, "WiFi");
  deduction(deductionTotals.other, ROLES.other, "Other");

  if (earned !== 0) {
    lines.push({
      accountId: accountFor(ROLES.income, "Rental income"),
      debit: 0,
      credit: earned,
      description: `Rent — ${rentMonthLabel(data.statementMonth)} and earlier`,
    });
  }
  if (unearned !== 0) {
    lines.push({
      accountId: accountFor(ROLES.unearned, "Unearned rent income"),
      debit: 0,
      credit: unearned,
      description: "Rent for months not yet reached",
    });
  }

  if (missing.length) {
    return {
      error: `No account is set for: ${[...new Set(missing)].join(", ")}. Set them in Configuration → Posting templates for the Rent statement voucher.`,
    };
  }
  if (lines.length === 0) {
    return { error: "Nothing to post — every line is long term, which is already invoiced." };
  }

  const statementId = crypto.randomUUID();
  const je = await createJournalEntry({
    companyId,
    voucherType: "rent_statement",
    voucherId: statementId,
    entryDate: data.statementDate,
    currencyId: data.currencyId,
    exchangeRate: data.exchangeRate,
    narration: data.narration || `Rent statement — ${rentMonthLabel(data.statementMonth)}`,
    createdBy,
    lines,
  });
  if ("error" in je) return { error: je.error };

  const { error: headerError } = await supabase.schema("rental").from("rent_statements").insert({
    id: statementId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    statement_date: data.statementDate,
    statement_month: monthStart(data.statementMonth),
    agent_account_id: data.agentAccountId,
    currency_id: data.currencyId,
    exchange_rate: data.exchangeRate,
    total_rent: round2(totals.rent),
    total_management: round2(totals.management),
    total_deductions: round2(totals.deductions),
    total_net: round2(totals.net),
    narration: data.narration || null,
    created_by: createdBy,
  });
  if (headerError) return { error: headerError.message };

  const { error: lineError } = await supabase
    .schema("rental")
    .from("rent_statement_lines")
    .insert(
      data.lines.map((l, i) => ({
        statement_id: statementId,
        line_no: i + 1,
        line_type: l.lineType,
        cost_center_id: l.costCenterId,
        period_from: l.periodFrom || null,
        period_to: l.periodTo || null,
        rent_month: monthStart(l.rentMonth),
        months: l.months,
        rent_amount: l.rentAmount,
        management_amount: l.managementAmount,
        dewa: l.dewa,
        internet: l.internet,
        access_card: l.accessCard,
        wifi: l.wifi,
        other: l.other,
        net_amount: round2(
          l.rentAmount - l.managementAmount - (l.dewa + l.internet + l.accessCard + l.wifi + l.other),
        ),
        remarks: l.remarks || null,
      })),
    );
  if (lineError) return { error: lineError.message };

  revalidatePath("/rental/rent-statements");
  return { success: true, id: statementId };
}
