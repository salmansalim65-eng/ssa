import { Suspense } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { loadAccountingPeriodStart } from "@/lib/reports/period";
import { formatDate } from "@/lib/format";

function startOfYear() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default async function CurrencyExchangePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from: spFrom, to = today() } = await searchParams;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const periodStart = await loadAccountingPeriodStart(companyId);
  const from = spFrom ?? periodStart ?? startOfYear();

  const { data: rows } = await supabase
    .schema("reporting")
    .from("v_currency_exchange_history")
    .select("*")
    .eq("company_id", companyId)
    .gte("rate_date", from)
    .lte("rate_date", to)
    .order("rate_date", { ascending: false });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Currency Exchange History"
        description={`Daily exchange rates recorded from ${formatDate(from)} to ${formatDate(to)}.`}
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`currency-exchange-${from}-to-${to}.csv`}
              headers={["S.No", "Currency", "Date", "Rate to base", "Source"]}
              rows={(rows ?? []).map((r, i) => [i + 1, r.currency_code, formatDate(r.rate_date), r.rate_to_base, r.source])}
            />
            <PrintButton />
          </>
        }
      />

      <Suspense>
        <DateRangeFilter defaultFrom={from} defaultTo={to} />
      </Suspense>

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 text-right">S.No</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Rate to base</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((r, i) => (
              <TableRow key={`${r.currency_code}-${r.rate_date}-${i}`}>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                <TableCell>{r.currency_code}</TableCell>
                <TableCell>{formatDate(r.rate_date)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{r.rate_to_base}</TableCell>
                <TableCell className="capitalize">{r.source}</TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No exchange rates recorded in this period.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
