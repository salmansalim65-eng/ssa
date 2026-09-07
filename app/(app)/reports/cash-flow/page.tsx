import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { ReportSelectFilter } from "@/components/reports/report-select-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

const HORIZONS = [
  { value: "1", label: "1 month" },
  { value: "2", label: "2 months" },
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "12 months" },
];

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthKey = (d: string) => d.slice(0, 7);
const monthLabel = (key: string) => `${MONTH_ABBR[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** The month keys from today's month forward, `count` of them. */
function horizonMonths(from: string, count: number): string[] {
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

interface CurrencyBlock {
  code: string;
  symbol: string;
  opening: number;
  /** Money in hand that belongs to somebody else (deposits held, tax provisions). */
  reserved: { name: string; amount: number }[];
  rows: { label: string; kind: "in" | "out"; overdue: number; byMonth: Map<string, number> }[];
}

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ months?: string }>;
}) {
  const { months: monthsParam = "" } = await searchParams;
  const horizon = HORIZONS.some((h) => h.value === monthsParam) ? Number(monthsParam) : 2;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const today = new Date().toISOString().slice(0, 10);
  const months = horizonMonths(today, horizon);
  const lastMonth = months[months.length - 1];
  // Everything falling due up to the end of the last month in view.
  const horizonEnd = `${lastMonth}-31`;

  const [{ data: ledger }, { data: invoices }, { data: pdcIn }, { data: pdcOut }, { data: currencies }] =
    await Promise.all([
      supabase
        .schema("reporting")
        .from("v_ledger_entries")
        .select("account_id, account_type, doc_debit_amount, doc_credit_amount, currency_code, is_cash, is_bank")
        .eq("company_id", companyId),
      supabase
        .schema("reporting")
        .from("v_rental_income")
        .select("due_date, net_outstanding, currency_code")
        .eq("company_id", companyId)
        .gt("net_outstanding", 0),
      supabase
        .schema("accounting")
        .from("pdc_receipt_voucher_lines")
        .select("due_date, amount, pdc_receipt_vouchers!inner(company_id, pdc_status, currency_id)")
        .eq("pdc_receipt_vouchers.company_id", companyId)
        .eq("pdc_receipt_vouchers.pdc_status", "pending")
        .lte("due_date", horizonEnd),
      supabase
        .schema("accounting")
        .from("pdc_payment_voucher_lines")
        .select("due_date, amount, pdc_payment_vouchers!inner(company_id, pdc_status, currency_id)")
        .eq("pdc_payment_vouchers.company_id", companyId)
        .eq("pdc_payment_vouchers.pdc_status", "pending")
        .lte("due_date", horizonEnd),
      supabase.schema("core").from("currencies").select("id, code, symbol"),
    ]);

  const currencyById = new Map(
    (currencies ?? []).map((c) => [c.id as string, { code: c.code as string, symbol: c.symbol as string }]),
  );
  const symbolByCode = new Map((currencies ?? []).map((c) => [c.code as string, c.symbol as string]));

  // ---- What is in the bank today, and what of it is already spoken for ----
  const openingByCode = new Map<string, number>();
  const reservedByCode = new Map<string, Map<string, number>>();
  const liabilityNames = new Map<string, string>();
  for (const l of ledger ?? []) {
    const code = (l.currency_code as string | null) ?? "";
    if (!code) continue;
    const net = Number(l.doc_debit_amount) - Number(l.doc_credit_amount);
    if (l.is_cash || l.is_bank) {
      openingByCode.set(code, (openingByCode.get(code) ?? 0) + net);
    } else if (l.account_type === "liability") {
      // A credit balance on a liability is money owed out — a deposit held for a
      // tenant, tax collected and not yet paid. It is in the bank but not yours.
      if (!reservedByCode.has(code)) reservedByCode.set(code, new Map());
      const per = reservedByCode.get(code)!;
      const id = l.account_id as string;
      per.set(id, (per.get(id) ?? 0) - net);
    }
  }
  const { data: liabilityAccounts } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_name")
    .eq("company_id", companyId)
    .eq("account_type", "liability");
  for (const a of liabilityAccounts ?? []) liabilityNames.set(a.id as string, a.account_name as string);

  // ---- Dated movements ----
  const blocks = new Map<string, CurrencyBlock>();
  const blockFor = (code: string): CurrencyBlock => {
    let b = blocks.get(code);
    if (!b) {
      b = {
        code,
        symbol: symbolByCode.get(code) ?? code,
        opening: openingByCode.get(code) ?? 0,
        reserved: [...(reservedByCode.get(code) ?? new Map())]
          .filter(([, amount]) => Math.abs(amount) >= 0.005)
          .map(([id, amount]) => ({ name: liabilityNames.get(id) ?? "Liability", amount }))
          .sort((x, y) => y.amount - x.amount),
        rows: [],
      };
      blocks.set(code, b);
    }
    return b;
  };
  const rowFor = (code: string, label: string, kind: "in" | "out") => {
    const block = blockFor(code);
    let row = block.rows.find((r) => r.label === label);
    if (!row) {
      row = { label, kind, overdue: 0, byMonth: new Map() };
      block.rows.push(row);
    }
    return row;
  };
  const add = (code: string, label: string, kind: "in" | "out", due: string, amount: number) => {
    if (!code || !due || !amount) return;
    const row = rowFor(code, label, kind);
    if (due < today) row.overdue += amount;
    else {
      const key = monthKey(due);
      if (!months.includes(key)) return;
      row.byMonth.set(key, (row.byMonth.get(key) ?? 0) + amount);
    }
  };

  for (const i of invoices ?? []) {
    add(
      (i.currency_code as string) ?? "",
      "Rent invoiced, not yet received",
      "in",
      (i.due_date as string) ?? "",
      Number(i.net_outstanding),
    );
  }
  type PdcLine = { due_date: string | null; amount: number };
  for (const l of (pdcIn ?? []) as unknown as (PdcLine & { pdc_receipt_vouchers: { currency_id: string } })[]) {
    add(
      currencyById.get(l.pdc_receipt_vouchers?.currency_id)?.code ?? "",
      "Cheques in hand maturing",
      "in",
      l.due_date ?? "",
      Number(l.amount),
    );
  }
  for (const l of (pdcOut ?? []) as unknown as (PdcLine & { pdc_payment_vouchers: { currency_id: string } })[]) {
    add(
      currencyById.get(l.pdc_payment_vouchers?.currency_id)?.code ?? "",
      "Cheques issued maturing",
      "out",
      l.due_date ?? "",
      Number(l.amount),
    );
  }
  // A currency with cash but no dated movement still belongs in the report.
  for (const code of openingByCode.keys()) blockFor(code);

  const ordered = [...blocks.values()].sort((a, b) => b.opening - a.opening);

  // ---- The answer: what is safe to take out ----
  // The running balance has to hold in EVERY month, not just the last one, so
  // the headroom is the LOWEST point the balance reaches — and overdue money is
  // left out of it, because money that was due and has not arrived may not.
  const summary = ordered.map((block) => {
    const reservedTotal = block.reserved.reduce((s, r) => s + r.amount, 0);
    let running = block.opening;
    const closings = months.map((m) => {
      for (const row of block.rows) {
        const amount = row.byMonth.get(m) ?? 0;
        running += row.kind === "in" ? amount : -amount;
      }
      return running;
    });
    const lowest = closings.length ? Math.min(...closings) : block.opening;
    const overdueIn = block.rows.reduce((s, r) => s + (r.kind === "in" ? r.overdue : 0), 0);
    const overdueOut = block.rows.reduce((s, r) => s + (r.kind === "out" ? r.overdue : 0), 0);
    return { block, closings, lowest, reservedTotal, available: lowest - reservedTotal, overdueIn, overdueOut };
  });

  const money = (symbol: string, n: number) => `${symbol ? `${symbol} ` : ""}${formatMoney(n)}`;

  const csvRows = summary.flatMap(({ block, closings, reservedTotal, available }) => [
    [block.code, "Cash & bank today", "", block.opening, ...months.map(() => "")],
    ...block.rows.map((r) => [
      block.code,
      r.label,
      r.overdue || "",
      "",
      ...months.map((m) => (r.kind === "in" ? 1 : -1) * (r.byMonth.get(m) ?? 0)),
    ]),
    [block.code, "Projected balance", "", "", ...closings],
    [block.code, "Held for others (deposits, tax)", "", reservedTotal, ...months.map(() => "")],
    [block.code, "Safe to withdraw", "", available, ...months.map(() => "")],
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Cash Flow Forecast"
        description={`What is in the bank today, what is due in and out over the next ${horizon} month${horizon === 1 ? "" : "s"}, and what is safe to take out.`}
        backHref="/dashboard"
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`cash-flow-forecast-${today}.csv`}
              headers={["Currency", "Line", "Already due", "Today", ...months.map(monthLabel)]}
              rows={csvRows}
            />
            <PrintButton />
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Suspense>
          <ReportSelectFilter
            label="Look ahead"
            param="months"
            allLabel="2 months"
            options={HORIZONS}
            selected={monthsParam}
            width="w-40"
          />
        </Suspense>
      </div>

      {/* The headline, one card per currency — money is never converted here: a
          PKR balance cannot settle an AED cheque. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary.map(({ block, available, lowest, reservedTotal }) => (
          <div
            key={block.code}
            className="overflow-hidden rounded-xl border-2 border-ledger-dark bg-card shadow-sm"
          >
            <div className="bg-ledger-dark px-3 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-white">
              {block.code} — safe to withdraw
            </div>
            <div className="space-y-2 px-4 py-3">
              <p
                className={cn(
                  "font-mono text-2xl font-bold tabular-nums",
                  available > 0 ? "text-foreground" : "text-destructive",
                )}
              >
                {money(block.symbol, available)}
              </p>
              <dl className="space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between gap-3">
                  <dt>In the bank today</dt>
                  <dd className="font-mono tabular-nums">{money(block.symbol, block.opening)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Lowest point in the next {horizon} month{horizon === 1 ? "" : "s"}</dt>
                  <dd className="font-mono tabular-nums">{money(block.symbol, lowest)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Less held for others</dt>
                  <dd className="font-mono tabular-nums text-destructive">
                    {reservedTotal ? `− ${money(block.symbol, reservedTotal)}` : money(block.symbol, 0)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        ))}
      </div>

      {summary.map(({ block, closings, reservedTotal, available, overdueIn, overdueOut }) => (
        <div key={block.code} className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {block.code}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-header text-header-foreground [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide">
                  <th className="text-left">Line</th>
                  <th className="text-right">Already due</th>
                  {months.map((m) => (
                    <th key={m} className="whitespace-nowrap text-right">
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b bg-muted/20 [&>td]:px-3 [&>td]:py-2">
                  <td className="font-medium">Cash &amp; bank today</td>
                  <td />
                  <td className="text-right font-mono font-semibold tabular-nums" colSpan={months.length}>
                    {money(block.symbol, block.opening)}
                  </td>
                </tr>
                {block.rows.length === 0 && (
                  <tr className="border-b [&>td]:px-3 [&>td]:py-6">
                    <td colSpan={months.length + 2} className="text-center text-muted-foreground">
                      Nothing is due in or out in this window.
                    </td>
                  </tr>
                )}
                {block.rows.map((r) => (
                  <tr key={r.label} className="border-b [&>td]:px-3 [&>td]:py-2">
                    <td>
                      <span className={cn("mr-2 font-mono text-xs", r.kind === "in" ? "text-success" : "text-destructive")}>
                        {r.kind === "in" ? "+" : "−"}
                      </span>
                      {r.label}
                    </td>
                    <td className="text-right font-mono tabular-nums text-muted-foreground">
                      {r.overdue ? money(block.symbol, r.overdue) : "—"}
                    </td>
                    {months.map((m) => {
                      const amount = r.byMonth.get(m) ?? 0;
                      return (
                        <td key={m} className="text-right font-mono tabular-nums">
                          {amount ? money(block.symbol, amount) : <span className="text-muted-foreground">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-b bg-ledger/10 font-semibold [&>td]:px-3 [&>td]:py-2">
                  <td>Projected balance at month end</td>
                  <td />
                  {closings.map((c, i) => (
                    <td
                      key={months[i]}
                      className={cn("text-right font-mono tabular-nums", c < 0 && "text-destructive")}
                    >
                      {money(block.symbol, c)}
                    </td>
                  ))}
                </tr>
                {block.reserved.map((r) => (
                  <tr key={r.name} className="border-b [&>td]:px-3 [&>td]:py-2">
                    <td className="text-muted-foreground">
                      <span className="mr-2 font-mono text-xs text-destructive">−</span>
                      {r.name} <span className="text-xs">(held, not yours)</span>
                    </td>
                    <td className="text-right font-mono tabular-nums text-destructive">
                      {money(block.symbol, r.amount)}
                    </td>
                    <td colSpan={months.length} />
                  </tr>
                ))}
                <tr className="bg-header font-semibold text-header-foreground [&>td]:px-3 [&>td]:py-2.5">
                  <td>
                    Safe to withdraw — lowest projected balance less {money(block.symbol, reservedTotal)} held
                  </td>
                  <td />
                  <td className="text-right font-mono text-base tabular-nums" colSpan={months.length}>
                    {money(block.symbol, available)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {(overdueIn > 0 || overdueOut > 0) && (
            <p className="border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
              {overdueIn > 0 && (
                <>
                  <span className="font-medium text-foreground">{money(block.symbol, overdueIn)}</span> was already due
                  in and has not arrived
                  {overdueOut > 0 ? ", " : ". "}
                </>
              )}
              {overdueOut > 0 && (
                <>
                  <span className="font-medium text-foreground">{money(block.symbol, overdueOut)}</span> was already due
                  out.{" "}
                </>
              )}
              Neither is counted above — money that was due and has not come may never come.
            </p>
          )}
        </div>
      ))}

      <div className="rounded-lg border bg-muted/20 px-4 py-3 text-xs text-muted-foreground print:hidden">
        <p className="mb-1 font-medium text-foreground">What this figure does and does not know</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>
            Only <strong>committed, dated</strong> money is counted: rent already invoiced and unpaid, and cheques
            already written. Rent that has not been invoiced yet is not a forecast — it is a guess.
          </li>
          <li>
            Running costs — salaries, utilities, service charges, tax falling due — are <strong>not</strong> in the
            app as dated commitments, so nothing deducts them. Subtract your own estimate before acting on this.
          </li>
          <li>Each currency stands alone. A PKR balance cannot settle an AED cheque.</li>
          <li>Balances are as of {formatDate(today)}, from posted entries only.</li>
        </ul>
      </div>
    </div>
  );
}
