"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher, type EntryLineInput } from "@/lib/vouchers/engine";
import { monthStart, rentMonthLabel, rentMonthsOf, splitOverMonths } from "@/lib/rental/rent-months";
import { rentStatementSchema, type RentStatementInput } from "./schemas";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Last day of the month a `YYYY-MM-01` date opens. */
function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

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
    // Rent and management are split separately and then netted — the same way
    // the bills are raised. Splitting the net instead puts the rounding fil in
    // the other month, and the entry stops agreeing with the bills behind it.
    const months = rentMonthsOf(l.rentMonth, l.months);
    const rentParts = splitOverMonths(round2(l.rentAmount), l.months);
    const mgmtParts = splitOverMonths(round2(l.managementAmount), l.months);
    months.forEach((m, i) => {
      const part = round2((rentParts[i] ?? 0) - (mgmtParts[i] ?? 0));
      if (m <= data.statementMonth) earned += part;
      else unearned += part;
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

/**
 * Post a statement.
 *
 * Two things happen, in this order, and the order matters: the entry reaches
 * the ledger first, and the invoices are raised from it afterwards. An invoice
 * standing against an entry that never posted would be a bill nobody owes.
 *
 * Each SHORT-TERM line raises an invoice for every month it covers — one bill
 * per unit per month, carrying that month's gross rent with the management cut
 * and the utilities the agent paid on our behalf beside it. Per unit and month
 * rather than one per statement, so a receipt can be adjusted unit by unit and
 * the Rent Balance can say which unit, and which month, is behind.
 *
 * LONG-TERM lines raise nothing. They are matched to the invoice that already
 * exists for that unit and month, and the match is written on the line so a
 * reader can see it rather than having to work it out.
 */
export async function postRentStatement(id: string) {
  await requirePermission("rent_statement", "post");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const { data: statement } = await supabase
    .schema("rental")
    .from("rent_statements")
    .select("id, journal_entry_id, statement_date, currency_id, exchange_rate, voucher_no")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!statement) return { error: "Statement not found" };
  if (statement.voucher_no) return { error: "This statement is already posted." };

  const { data: lineRows } = await supabase
    .schema("rental")
    .from("rent_statement_lines")
    .select(
      "id, line_no, line_type, cost_center_id, period_from, period_to, rent_month, months, rent_amount, management_amount, dewa, internet, access_card, wifi, other, net_amount",
    )
    .eq("statement_id", id)
    .order("line_no");
  const lines = (lineRows ?? []) as {
    id: string;
    line_type: "short_term" | "long_term";
    cost_center_id: string | null;
    period_from: string | null;
    period_to: string | null;
    rent_month: string;
    months: number;
    rent_amount: number;
    management_amount: number;
    dewa: number;
    internet: number;
    access_card: number;
    wifi: number;
    other: number;
    net_amount: number;
  }[];

  const result = await postVoucher({
    companyId,
    voucherType: "rent_statement",
    journalEntryId: statement.journal_entry_id as string,
  });
  if ("error" in result) return result;

  const { error: noError } = await supabase
    .schema("rental")
    .from("rent_statements")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id);
  if (noError) return { error: noError.message };

  // One invoice per short-term line PER MONTH it covers.
  //
  // A line that runs two months (18-07 to 17-09) is two bills, not one: the
  // Rent Balance asks what fell due in August and what fell due in September,
  // and a single August bill for both answers neither. The split mirrors the
  // journal entry exactly — August's share is earned, September's sits in
  // Unearned Rent Income — so the report and the ledger say the same thing.
  //
  // Amounts are GROSS rent, with the agent's management cut and the utilities
  // he paid carried alongside, because that is how the Rent Balance reads every
  // other UAE invoice. The deductions sit on the FIRST month: the agent took
  // them out of THIS statement, once.
  const failures: string[] = [];
  // Bills are numbered off the statement — RS-000002-1, -2, -3 — and not from
  // the rent-invoice sequence.
  //
  // That sequence heals itself by never issuing past the highest number in the
  // voucher register, and the register knows a journal entry by ITS voucher
  // type. These bills hang off a rent_statement entry, so the register reads
  // RS-000002 for all of them and the highest URI number never moves: the
  // sequence handed out the same number to every bill after the first, and
  // seven of eight collided on (company_id, voucher_no).
  //
  // Numbering them off the statement needs no sequence, cannot race, and says
  // on every report which statement raised the bill.
  let billNo = 0;
  for (const l of lines.filter((x) => x.line_type === "short_term")) {
    const months = Math.max(1, Number(l.months) || 1);
    const rentParts = splitOverMonths(round2(Number(l.rent_amount)), months);
    const mgmtParts = splitOverMonths(round2(Number(l.management_amount)), months);
    const deductions = round2(
      Number(l.dewa) + Number(l.internet) + Number(l.access_card) + Number(l.wifi) + Number(l.other),
    );
    const monthList = rentMonthsOf(l.rent_month, months);

    for (let i = 0; i < months; i += 1) {
      const gross = rentParts[i] ?? 0;
      const management = mgmtParts[i] ?? 0;
      const otherExpenses = i === 0 ? deductions : 0;
      if (gross === 0 && management === 0 && otherExpenses === 0) continue;

      billNo += 1;
      const voucherNo = `${result.voucherNo}-${billNo}`;

      const invoiceId = crypto.randomUUID();
      const { error } = await supabase.schema("rental").from("uae_rent_invoices").insert({
        id: invoiceId,
        company_id: companyId,
        journal_entry_id: statement.journal_entry_id,
        // No lease: the letting IS this line (0147).
        lease_id: null,
        rent_statement_line_id: l.id,
        voucher_no: voucherNo,
        invoice_date: statement.statement_date,
        // Rent is owed for the month it belongs to, so that is when it falls due.
        due_date: monthList[i],
        // The MONTH, not the agent's own window. A letting running 28-07 to
        // 27-08 is August's rent, and a period starting in July would have the
        // month-wise tally call it July's. The real window stays on the
        // statement line, which is where the sheet is read back.
        period_start: monthList[i],
        period_end: monthEnd(monthList[i]),
        amount: gross,
        management_amount: management,
        other_expenses: otherExpenses,
        currency_id: statement.currency_id,
        exchange_rate: statement.exchange_rate,
        outstanding_balance: gross,
        invoice_type: "HH",
        created_by: createdBy,
      });
      // A failure here must not abandon the rest: the statement is already
      // posted, and the bills that CAN be raised are better raised than lost.
      if (error) {
        failures.push(`${rentMonthLabel(monthList[i])}: ${error.message}`);
        continue;
      }
      if (i === 0) {
        await supabase
          .schema("rental")
          .from("rent_statement_lines")
          .update({ raised_invoice_id: invoiceId })
          .eq("id", l.id);
      }
    }
  }

  await matchLongTermLines(companyId, lines);

  revalidatePath("/rental/rent-statements");
  revalidatePath(`/rental/rent-statements/${id}`);
  revalidatePath("/dashboard");
  if (failures.length > 0) {
    return {
      success: true,
      voucherNo: result.voucherNo,
      warning: `Posted, but these bills were not raised — ${failures.join("; ")}`,
    };
  }
  return { success: true, voucherNo: result.voucherNo };
}

/**
 * Tie each long-term line to the invoices that already bill it.
 *
 * Best-effort: a line that finds no invoice is left unmatched rather than
 * failing the posting. The statement is still right — the invoice simply has
 * not been raised from the lease yet, and the match can be made when it is.
 * Silently raising a second invoice instead is the one thing that must not
 * happen, which is why nothing is created here.
 *
 * Matched by PROPERTY and month, not by month alone: two units billed for the
 * same month are indistinguishable otherwise, and the first one found wins.
 * Every month the line covers is matched, so a two-month line claims both of
 * its bills and the statement's tally can show what each month came to.
 */
async function matchLongTermLines(
  companyId: string,
  lines: { id: string; line_type: string; cost_center_id: string | null; rent_month: string; months: number }[],
) {
  const longTerm = lines.filter((l) => l.line_type === "long_term");
  if (longTerm.length === 0) return;

  const supabase = await createClient();

  // The property behind each line, and the leases on that property.
  const ccIds = [...new Set(longTerm.map((l) => l.cost_center_id).filter(Boolean))] as string[];
  const { data: ccRows } = ccIds.length
    ? await supabase.schema("accounting").from("cost_centers").select("id, asset_id").in("id", ccIds)
    : { data: [] as { id: string; asset_id: string | null }[] };
  const assetByCc = new Map(
    ((ccRows as { id: string; asset_id: string | null }[]) ?? []).map((c) => [c.id, c.asset_id]),
  );
  const assetIds = [...new Set([...assetByCc.values()].filter(Boolean))] as string[];
  const { data: leaseRows } = assetIds.length
    ? await supabase
        .schema("rental")
        .from("uae_leases")
        .select("id, asset_id")
        .in("asset_id", assetIds)
        .is("deleted_at", null)
    : { data: [] as { id: string; asset_id: string }[] };
  const leasesByAsset = new Map<string, string[]>();
  for (const l of ((leaseRows as { id: string; asset_id: string }[]) ?? [])) {
    leasesByAsset.set(l.asset_id, [...(leasesByAsset.get(l.asset_id) ?? []), l.id]);
  }

  for (const l of longTerm) {
    const assetId = l.cost_center_id ? assetByCc.get(l.cost_center_id) : null;
    const leaseIds = assetId ? (leasesByAsset.get(assetId) ?? []) : [];
    if (leaseIds.length === 0) continue;

    let firstMatch: string | null = null;
    for (const month of rentMonthsOf(l.rent_month, Math.max(1, Number(l.months) || 1))) {
      const { data } = await supabase
        .schema("rental")
        .from("uae_rent_invoices")
        .select("id")
        .eq("company_id", companyId)
        .in("lease_id", leaseIds)
        .eq("period_start", month)
        .is("rent_statement_line_id", null)
        .limit(1);
      const match = (data ?? [])[0] as { id: string } | undefined;
      if (!match) continue;
      // Stamping the line on the invoice is what lets the statement's tally
      // find it again — and what stops a later statement claiming it twice.
      await supabase
        .schema("rental")
        .from("uae_rent_invoices")
        .update({ rent_statement_line_id: l.id })
        .eq("id", match.id);
      if (!firstMatch) firstMatch = match.id;
    }
    if (firstMatch) {
      await supabase
        .schema("rental")
        .from("rent_statement_lines")
        .update({ matched_invoice_id: firstMatch })
        .eq("id", l.id);
    }
  }
}

/**
 * Remember what the agent's sheet calls each unit.
 *
 * Asked once, on the first statement that names it; after that an import maps
 * the row by itself. Matching unit names by eye on every import is how a
 * letting quietly lands on the wrong property.
 */
export async function rememberUnitAliases(pairs: { alias: string; costCenterId: string }[]) {
  const clean = pairs.filter((p) => p.alias?.trim() && p.costCenterId);
  if (clean.length === 0) return { success: true };

  await requirePermission("rent_statement", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  // Unique on (company, lowercased alias), so re-importing the same sheet
  // leaves one row rather than a pile of identical ones.
  const { error } = await supabase
    .schema("rental")
    .from("unit_aliases")
    .upsert(
      clean.map((p) => ({
        company_id: companyId,
        alias: p.alias.trim(),
        cost_center_id: p.costCenterId,
        created_by: user.user!.id,
      })),
      { onConflict: "company_id,alias", ignoreDuplicates: true },
    );
  if (error) return { error: error.message };
  return { success: true };
}
