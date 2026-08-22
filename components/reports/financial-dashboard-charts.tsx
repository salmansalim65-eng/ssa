"use client";

import {
  ChartCard,
  DonutChart,
  HBarChart,
  LineChart,
  compactNumber,
  type DonutDatum,
  type HBarDatum,
  type LinePoint,
} from "@/components/reports/charts";

function Empty() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
      No data yet.
    </div>
  );
}

/**
 * Financial-dashboard charts (all base currency). Client-side because the shared
 * ChartCard takes a render-prop, which can't cross the server boundary.
 */
export function FinancialDashboardCharts({
  symbol,
  position,
  incomeExpense,
  monthlyNet,
  expenseByCc,
}: {
  symbol: string;
  position: DonutDatum[];
  incomeExpense: DonutDatum[];
  monthlyNet: LinePoint[];
  expenseByCc: HBarDatum[];
}) {
  const fmt = (n: number) => `${symbol ? symbol + " " : ""}${compactNumber(n)}`;
  const has = (arr: { value: number }[]) => arr.some((d) => d.value > 0);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartCard
        title="Financial Position"
        subtitle="Assets vs Liabilities vs Equity"
        csv={{ headers: ["Item", "Amount"], rows: position.map((d) => [d.label, Math.round(d.value)]) }}
        chart={(h) => (has(position) ? <DonutChart data={position} height={h} format={fmt} /> : <Empty />)}
      />
      <ChartCard
        title="Income vs Expenses"
        subtitle="Year to date"
        csv={{ headers: ["Item", "Amount"], rows: incomeExpense.map((d) => [d.label, Math.round(d.value)]) }}
        chart={(h) => (has(incomeExpense) ? <DonutChart data={incomeExpense} height={h} format={fmt} /> : <Empty />)}
      />
      <ChartCard
        title="Net Profit by Month"
        subtitle="Income − expenses, base currency"
        csv={{ headers: ["Month", "Net"], rows: monthlyNet.map((p) => [p.label, Math.round(p.value)]) }}
        chart={(h) => (monthlyNet.length ? <LineChart points={monthlyNet} height={h} format={fmt} /> : <Empty />)}
      />
      <ChartCard
        title="Expenses by Cost Centre"
        subtitle="Year to date, top 8"
        csv={{ headers: ["Cost centre", "Amount"], rows: expenseByCc.map((d) => [d.label, Math.round(d.value)]) }}
        chart={(h) => (has(expenseByCc) ? <HBarChart data={expenseByCc} height={h} format={fmt} /> : <Empty />)}
      />
    </div>
  );
}
