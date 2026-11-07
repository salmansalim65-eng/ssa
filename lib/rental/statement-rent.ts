import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * What the agent's statements say, for the reports that used to read leases.
 *
 * A short-term unit has no lease. Its letting is a line on the agent's monthly
 * sheet, and the bill that line raises is the record — so every report built on
 * `uae_leases` called those units vacant for every month of the year while the
 * statements said otherwise. There are two leases in the whole company and both
 * are long-term.
 *
 * Only POSTED statements count anywhere here. A draft is somebody's reading of
 * a piece of paper; it is not rent until it is posted.
 */

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Ids of the journal entries that are posted, among those given. */
async function postedEntries(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounting")
    .from("journal_entries")
    .select("id, status")
    .in("id", [...new Set(ids)]);
  return new Set(
    ((data ?? []) as { id: string; status: string }[]).filter((e) => e.status === "posted").map((e) => e.id),
  );
}

/**
 * Net rent billed from the statements, per cost centre, per month of a year.
 *
 * A bill is one unit for one month: `period_start` is the month it is for, and
 * net is the gross rent less the agent's cut and the utilities he deducted —
 * the same "net rent" a lease row means.
 *
 * Returns an array of twelve per cost centre; a cost centre the statements
 * never named is absent rather than zero-filled, so a caller can tell "nothing
 * billed" from "not a statement unit".
 */
export async function loadStatementRentByMonth(
  companyId: string,
  year: number,
): Promise<Map<string, number[]>> {
  const supabase = await createClient();

  const { data: billRows } = await supabase
    .schema("rental")
    .from("uae_rent_invoices")
    .select("journal_entry_id, period_start, amount, management_amount, other_expenses, rent_statement_line_id")
    .eq("company_id", companyId)
    .is("lease_id", null)
    .gte("period_start", `${year}-01-01`)
    .lte("period_start", `${year}-12-31`);
  const bills = ((billRows ?? []) as {
    journal_entry_id: string;
    period_start: string;
    amount: number;
    management_amount: number | null;
    other_expenses: number | null;
    rent_statement_line_id: string | null;
  }[]).filter((b) => b.rent_statement_line_id);
  if (bills.length === 0) return new Map();

  const [{ data: lineRows }, posted] = await Promise.all([
    supabase
      .schema("rental")
      .from("rent_statement_lines")
      .select("id, cost_center_id")
      .in("id", bills.map((b) => b.rent_statement_line_id as string)),
    postedEntries(bills.map((b) => b.journal_entry_id)),
  ]);
  const centreOfLine = new Map(
    ((lineRows ?? []) as { id: string; cost_center_id: string | null }[]).map((l) => [l.id, l.cost_center_id]),
  );

  const byCentre = new Map<string, number[]>();
  for (const b of bills) {
    if (!posted.has(b.journal_entry_id)) continue;
    const centre = centreOfLine.get(b.rent_statement_line_id as string);
    if (!centre) continue;
    const month = Number(b.period_start.slice(5, 7)) - 1;
    if (month < 0 || month > 11) continue;
    const net = Number(b.amount) - Number(b.management_amount ?? 0) - Number(b.other_expenses ?? 0);
    const row = byCentre.get(centre) ?? (Array(12).fill(0) as number[]);
    row[month] = round2(row[month] + net);
    byCentre.set(centre, row);
  }
  return byCentre;
}

/** One letting, exactly as the agent's sheet gives its two ends. */
export interface StatementStay {
  costCenterId: string;
  from: string;
  to: string;
}

/**
 * Every short-term letting the statements record, with its real dates.
 *
 * Occupancy is about DAYS, and these are the days: `period_from` and
 * `period_to` are the agent's own, the window he actually let the unit for.
 * They are better evidence than a lease ever was, because the lease was a
 * monthly abstraction over them.
 *
 * Long-term lines are left out: they restate a letting invoiced from a lease,
 * and counting both would let the same unit twice.
 */
export async function loadStatementStays(companyId: string): Promise<StatementStay[]> {
  const supabase = await createClient();

  const { data: statementRows } = await supabase
    .schema("rental")
    .from("rent_statements")
    .select("id, journal_entry_id")
    .eq("company_id", companyId)
    .not("voucher_no", "is", null);
  const statements = (statementRows ?? []) as { id: string; journal_entry_id: string }[];
  if (statements.length === 0) return [];

  const posted = await postedEntries(statements.map((s) => s.journal_entry_id));
  const live = statements.filter((s) => posted.has(s.journal_entry_id)).map((s) => s.id);
  if (live.length === 0) return [];

  const { data: lineRows } = await supabase
    .schema("rental")
    .from("rent_statement_lines")
    .select("cost_center_id, period_from, period_to, line_type")
    .in("statement_id", live)
    .eq("line_type", "short_term");

  return ((lineRows ?? []) as {
    cost_center_id: string | null;
    period_from: string | null;
    period_to: string | null;
  }[])
    .filter((l) => l.cost_center_id && l.period_from && l.period_to)
    .map((l) => ({
      costCenterId: l.cost_center_id as string,
      from: l.period_from as string,
      to: l.period_to as string,
    }));
}

/** The latest letting a unit is on, as the statements record it. */
export interface StatementCurrent {
  gross: number;
  management: number;
  other: number;
  from: string;
  to: string;
}

/**
 * What each short-term unit is let at NOW, from its most recent bill.
 *
 * A lease states a monthly rent; a statement does not, so the latest month
 * billed stands for it — the rent the unit is on. Its stay's two ends come
 * with it, so a report can tell whether the unit is let today or was last let
 * three weeks ago and is standing empty.
 */
export async function loadStatementCurrent(companyId: string): Promise<Map<string, StatementCurrent>> {
  const supabase = await createClient();

  const { data: billRows } = await supabase
    .schema("rental")
    .from("uae_rent_invoices")
    .select("journal_entry_id, period_start, amount, management_amount, other_expenses, rent_statement_line_id")
    .eq("company_id", companyId)
    .is("lease_id", null)
    .order("period_start");
  const bills = ((billRows ?? []) as {
    journal_entry_id: string;
    period_start: string;
    amount: number;
    management_amount: number | null;
    other_expenses: number | null;
    rent_statement_line_id: string | null;
  }[]).filter((b) => b.rent_statement_line_id);
  if (bills.length === 0) return new Map();

  const [{ data: lineRows }, posted] = await Promise.all([
    supabase
      .schema("rental")
      .from("rent_statement_lines")
      .select("id, cost_center_id, period_from, period_to")
      .in("id", bills.map((b) => b.rent_statement_line_id as string)),
    postedEntries(bills.map((b) => b.journal_entry_id)),
  ]);
  const lineById = new Map(
    ((lineRows ?? []) as {
      id: string;
      cost_center_id: string | null;
      period_from: string | null;
      period_to: string | null;
    }[]).map((l) => [l.id, l]),
  );

  const latest = new Map<string, { month: string; value: StatementCurrent }>();
  for (const b of bills) {
    if (!posted.has(b.journal_entry_id)) continue;
    const line = lineById.get(b.rent_statement_line_id as string);
    if (!line?.cost_center_id || !line.period_from || !line.period_to) continue;
    const held = latest.get(line.cost_center_id);
    if (held && held.month >= b.period_start) continue;
    latest.set(line.cost_center_id, {
      month: b.period_start,
      value: {
        gross: round2(Number(b.amount)),
        management: round2(Number(b.management_amount ?? 0)),
        other: round2(Number(b.other_expenses ?? 0)),
        from: line.period_from,
        to: line.period_to,
      },
    });
  }
  return new Map([...latest].map(([centre, held]) => [centre, held.value]));
}
