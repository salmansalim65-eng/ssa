import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { TABLE_TOTAL_ROW } from "@/components/ui/table";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { PostStatementButton } from "./post-button";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, formatVoucherNo } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { monthStart, rentMonthLabel } from "@/lib/rental/rent-months";
import { cn } from "@/lib/utils";
import type { JournalEntryStatus } from "@/types/database.types";

/**
 * A statement as entered, read back against the paper.
 *
 * The lines in the agent's own order, the totals the sheet's own, and — the
 * reason this screen exists — what each month of it comes to. A statement that
 * bills two months at once is the normal case here, and the month breakdown is
 * the only place that says so plainly.
 */
export default async function RentStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [canView, canPost] = await Promise.all([
    hasPermission("rent_statement", "view"),
    hasPermission("rent_statement", "post"),
  ]);
  if (!canView) notFound();

  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data: statement } = await supabase
    .schema("rental")
    .from("rent_statements")
    .select(
      "id, voucher_no, statement_date, statement_month, total_rent, total_management, total_deductions, total_net, narration, journal_entry_id, agent_account_id",
    )
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (!statement) notFound();

  const [{ data: lineRows }, { data: entry }, { data: agent }] = await Promise.all([
    supabase
      .schema("rental")
      .from("rent_statement_lines")
      .select(
        "id, line_no, line_type, cost_center_id, period_from, period_to, rent_month, months, rent_amount, management_amount, dewa, internet, access_card, wifi, other, net_amount, remarks",
      )
      .eq("statement_id", id)
      .order("line_no"),
    supabase
      .schema("accounting")
      .from("journal_entries")
      .select("status")
      .eq("id", statement.journal_entry_id as string)
      .maybeSingle(),
    supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("account_name")
      .eq("id", statement.agent_account_id as string)
      .maybeSingle(),
  ]);

  const lines = (lineRows ?? []) as {
    id: string;
    line_no: number;
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
    remarks: string | null;
  }[];

  const unitIds = [...new Set(lines.map((l) => l.cost_center_id).filter(Boolean))] as string[];
  const { data: units } = unitIds.length
    ? await supabase.schema("accounting").from("cost_centers").select("id, name").in("id", unitIds)
    : { data: [] as { id: string; name: string }[] };
  const unitName = new Map((units ?? []).map((u) => [u.id as string, u.name as string]));

  const statementMonth = statement.statement_month as string;

  // What each month of this statement comes to — read back off the BILLS it
  // stands behind, not off the lines alone.
  //
  // A statement covers more than it bills: the long-term units were already
  // invoiced from their leases, and some of those bills may already be paid.
  // Reading the months off the invoices is the only way the tally can say
  // "42,029 billed, 15,200 already received, 26,829 still owed" — the question
  // the Rent Balance cannot answer, because a settled month drops off it.
  //
  // Months come from each bill's PERIOD, never its due date: rent billed in
  // advance falls due in August for a September letting, and bucketing by the
  // due date would call that September rent August's.
  const lineIds = lines.map((l) => l.id);
  const { data: invRows } = lineIds.length
    ? await supabase
        .schema("rental")
        .from("uae_rent_invoices")
        .select("id, period_start, rent_statement_line_id")
        .in("rent_statement_line_id", lineIds)
    : { data: [] as { id: string; period_start: string }[] };
  const bills = (invRows as { id: string; period_start: string }[]) ?? [];
  const monthOfBill = new Map(bills.map((b) => [b.id, monthStart(b.period_start)]));

  const { data: billFigures } = bills.length
    ? await supabase
        .schema("reporting")
        .from("v_rental_income")
        .select("invoice_id, amount, agent_share, other_expenses, net_amount, net_outstanding")
        .eq("company_id", companyId)
        .in(
          "invoice_id",
          bills.map((b) => b.id),
        )
    : { data: [] as never[] };

  interface MonthTally {
    rent: number;
    management: number;
    deductions: number;
    net: number;
    received: number;
    balance: number;
  }
  const blank = (): MonthTally => ({ rent: 0, management: 0, deductions: 0, net: 0, received: 0, balance: 0 });
  const byMonth = new Map<string, MonthTally>();
  for (const f of (billFigures ?? []) as {
    invoice_id: string;
    amount: number;
    agent_share: number;
    other_expenses: number;
    net_amount: number;
    net_outstanding: number;
  }[]) {
    const month = monthOfBill.get(f.invoice_id);
    if (!month) continue;
    const t = byMonth.get(month) ?? blank();
    t.rent += Number(f.amount);
    t.management += Number(f.agent_share);
    t.deductions += Number(f.other_expenses);
    t.net += Number(f.net_amount);
    t.balance += Number(f.net_outstanding);
    // Settled, not strictly "received": a journal adjustment closes a bill the
    // same way a receipt does, and both belong on this side of the line.
    t.received += Number(f.net_amount) - Number(f.net_outstanding);
    byMonth.set(month, t);
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  const grand = months.reduce((acc, [, t]) => {
    acc.rent += t.rent;
    acc.management += t.management;
    acc.deductions += t.deductions;
    acc.net += t.net;
    acc.received += t.received;
    acc.balance += t.balance;
    return acc;
  }, blank());
  // A draft statement has raised nothing yet, so there is nothing to tally.
  const hasBills = months.length > 0;

  const deductionsOf = (l: (typeof lines)[number]) =>
    l.dewa + l.internet + l.access_card + l.wifi + l.other;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rent statement"
        title={statement.voucher_no ? formatVoucherNo(statement.voucher_no as string) : "Draft"}
        description={`${(agent?.account_name as string) ?? "Agent"} · ${rentMonthLabel(statementMonth)} · dated ${formatDate(statement.statement_date as string)}`}
        backHref="/rental/rent-statements"
        actions={
          <>
            <VoucherStatusBadge status={((entry?.status as JournalEntryStatus) ?? "draft")} />
            {canPost && entry?.status !== "posted" && <PostStatementButton id={id} />}
          </>
        }
      />

      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground">
              <th className="w-10 text-right">#</th>
              <th className="text-left">Unit</th>
              <th className="text-left">Period</th>
              <th className="text-left">Rent month</th>
              <th className="text-right">Rent</th>
              <th className="text-right">Management</th>
              <th className="text-right">Deductions</th>
              <th className="text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b [&>td]:px-3 [&>td]:py-2">
                <td className="text-right font-mono text-xs tabular-nums text-muted-foreground">{l.line_no}</td>
                <td>
                  <span className="font-medium">{unitName.get(l.cost_center_id ?? "") ?? "—"}</span>
                  <span
                    className={cn(
                      "ml-2 rounded px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide",
                      l.line_type === "long_term"
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {l.line_type === "long_term" ? "Long term" : "Short term"}
                  </span>
                </td>
                <td className="text-xs text-muted-foreground">
                  {l.period_from && l.period_to
                    ? `${formatDate(l.period_from)} – ${formatDate(l.period_to)}`
                    : "—"}
                </td>
                <td className="text-xs">
                  {rentMonthLabel(l.rent_month)}
                  {l.months > 1 && (
                    <span className="text-muted-foreground"> +{l.months - 1}</span>
                  )}
                </td>
                <td className="text-right font-mono tabular-nums">{formatMoney(l.rent_amount)}</td>
                <td className="text-right font-mono tabular-nums text-muted-foreground">
                  {formatMoney(l.management_amount)}
                </td>
                <td className="text-right font-mono tabular-nums text-muted-foreground">
                  {deductionsOf(l) ? formatMoney(deductionsOf(l)) : "—"}
                </td>
                <td className="text-right font-mono font-semibold tabular-nums">{formatMoney(l.net_amount)}</td>
              </tr>
            ))}
            <tr className={cn(TABLE_TOTAL_ROW, "[&>td]:px-3 [&>td]:py-2")}>
              <td colSpan={4} className="text-xs uppercase tracking-wide">
                Total — as the sheet states it
              </td>
              <td className="text-right font-mono tabular-nums">{formatMoney(statement.total_rent as number)}</td>
              <td className="text-right font-mono tabular-nums">
                {formatMoney(statement.total_management as number)}
              </td>
              <td className="text-right font-mono tabular-nums">
                {formatMoney(statement.total_deductions as number)}
              </td>
              <td className="text-right font-mono tabular-nums">{formatMoney(statement.total_net as number)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {hasBills && (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <p className="border-b px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Month by month — billed, received, still owed
          </p>
          <table className="w-full min-w-[800px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground">
                <th className="text-left">Rent month</th>
                <th className="text-right">Rent</th>
                <th className="text-right">Management</th>
                <th className="text-right">Deductions</th>
                <th className="text-right">Balance rent</th>
                <th className="text-right">Received</th>
                <th className="text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {months.map(([month, t]) => (
                <tr key={month} className="border-b [&>td]:px-3 [&>td]:py-2">
                  <td className="whitespace-nowrap">
                    <span className={cn(month === statementMonth ? "font-medium" : "")}>
                      {rentMonthLabel(month)}
                    </span>
                    {month > statementMonth && (
                      <span className="ml-2 text-xs text-muted-foreground">billed in advance</span>
                    )}
                    {month < statementMonth && (
                      <span className="ml-2 text-xs text-muted-foreground">earlier month</span>
                    )}
                  </td>
                  <td className="text-right font-mono tabular-nums">{formatMoney(t.rent)}</td>
                  <td className="text-right font-mono tabular-nums text-muted-foreground">
                    {formatMoney(t.management)}
                  </td>
                  <td className="text-right font-mono tabular-nums text-muted-foreground">
                    {t.deductions ? formatMoney(t.deductions) : "—"}
                  </td>
                  <td className="text-right font-mono font-semibold tabular-nums">{formatMoney(t.net)}</td>
                  <td className="text-right font-mono tabular-nums text-muted-foreground">
                    {t.received ? formatMoney(t.received) : "—"}
                  </td>
                  <td
                    className={cn(
                      "text-right font-mono font-semibold tabular-nums",
                      t.balance > 0 ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {t.balance ? formatMoney(t.balance) : "—"}
                  </td>
                </tr>
              ))}
              <tr className={cn(TABLE_TOTAL_ROW, "[&>td]:px-3 [&>td]:py-2")}>
                <td className="text-xs uppercase tracking-wide">Total</td>
                <td className="text-right font-mono tabular-nums">{formatMoney(grand.rent)}</td>
                <td className="text-right font-mono tabular-nums">{formatMoney(grand.management)}</td>
                <td className="text-right font-mono tabular-nums">{formatMoney(grand.deductions)}</td>
                <td className="text-right font-mono tabular-nums">{formatMoney(grand.net)}</td>
                <td className="text-right font-mono tabular-nums">{formatMoney(grand.received)}</td>
                <td className="text-right font-mono tabular-nums">{formatMoney(grand.balance)}</td>
              </tr>
            </tbody>
          </table>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            Every bill this statement stands behind — the short-term units it raised and the long-term
            units already invoiced from their leases — by the month each one is FOR. A line covering two
            months is half in each, never spread by day. Balance Rent should come back to the sheet&apos;s own
            net total; what is left in Outstanding is what the agent still owes.
          </p>
        </div>
      )}

      {statement.narration ? (
        <p className="text-sm text-muted-foreground">{statement.narration as string}</p>
      ) : null}
    </div>
  );
}
