import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { TABLE_TOTAL_ROW } from "@/components/ui/table";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, formatVoucherNo } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { rentMonthLabel, rentMonthsOf, splitOverMonths } from "@/lib/rental/rent-months";
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
  if (!(await hasPermission("rent_statement", "view"))) notFound();

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

  // What each month of this statement comes to, by the rent month of each line
  // and not by any spread of days. A two-month line lands half in each.
  const byMonth = new Map<string, number>();
  for (const l of lines) {
    const netRent = Math.round((l.rent_amount - l.management_amount) * 100) / 100;
    const months = rentMonthsOf(l.rent_month, l.months);
    const parts = splitOverMonths(netRent, l.months);
    months.forEach((m, i) => byMonth.set(m, (byMonth.get(m) ?? 0) + parts[i]));
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  const statementMonth = statement.statement_month as string;

  const deductionsOf = (l: (typeof lines)[number]) =>
    l.dewa + l.internet + l.access_card + l.wifi + l.other;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rent statement"
        title={statement.voucher_no ? formatVoucherNo(statement.voucher_no as string) : "Draft"}
        description={`${(agent?.account_name as string) ?? "Agent"} · ${rentMonthLabel(statementMonth)} · dated ${formatDate(statement.statement_date as string)}`}
        backHref="/rental/rent-statements"
        actions={<VoucherStatusBadge status={((entry?.status as JournalEntryStatus) ?? "draft")} />}
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

      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Rent by month
        </p>
        <ul className="space-y-1.5">
          {months.map(([month, amount]) => (
            <li key={month} className="flex items-baseline justify-between gap-3 text-sm">
              <span className={cn(month === statementMonth ? "font-medium text-foreground" : "text-muted-foreground")}>
                {rentMonthLabel(month)}
                {month > statementMonth && (
                  <span className="ml-2 text-xs text-muted-foreground">not yet reached</span>
                )}
                {month < statementMonth && (
                  <span className="ml-2 text-xs text-muted-foreground">earlier month</span>
                )}
              </span>
              <span className="font-mono tabular-nums">{formatMoney(amount)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
          Rent less management, by the month each letting belongs to. A line covering two months is half
          in each — never spread by day.
        </p>
      </div>

      {statement.narration ? (
        <p className="text-sm text-muted-foreground">{statement.narration as string}</p>
      ) : null}
    </div>
  );
}
