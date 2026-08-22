"use client";

import {
  ChartCard,
  LineChart,
  DonutChart,
  compactNumber,
} from "@/components/reports/charts";

export interface MonthlyPoint {
  label: string;
  value: number;
}
export interface CountrySlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

function Empty() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
      No data yet.
    </div>
  );
}

/**
 * Dashboard analytics charts (base currency). Rendered client-side because the
 * shared ChartCard takes a render-prop, which can't cross the server boundary.
 */
export function DashboardCharts({
  symbol,
  monthly,
  outstanding,
}: {
  symbol: string;
  monthly: MonthlyPoint[];
  outstanding: CountrySlice[];
}) {
  const fmt = (n: number) => `${symbol ? symbol + " " : ""}${compactNumber(n)}`;
  const hasMonthly = monthly.some((m) => m.value > 0);
  const hasOutstanding = outstanding.some((d) => d.value > 0);
  const outstandingTotal = outstanding.reduce((s, d) => s + d.value, 0);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartCard
        title="Monthly Rent Billed"
        subtitle="Owner's net rent, base currency"
        csv={{ headers: ["Month", "Amount"], rows: monthly.map((m) => [m.label, Math.round(m.value)]) }}
        chart={(h) => (hasMonthly ? <LineChart points={monthly} height={h} format={fmt} /> : <Empty />)}
      />
      <ChartCard
        title="Outstanding by Country"
        subtitle="Uncollected net rent, base currency"
        csv={{ headers: ["Country", "Outstanding"], rows: outstanding.map((o) => [o.label, Math.round(o.value)]) }}
        chart={(h) =>
          hasOutstanding ? (
            <DonutChart
              data={outstanding}
              height={h}
              format={fmt}
              centerTitle="Total"
              centerValue={fmt(outstandingTotal)}
            />
          ) : (
            <Empty />
          )
        }
      />
    </div>
  );
}
