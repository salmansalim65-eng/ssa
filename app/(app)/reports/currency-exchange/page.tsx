import { Suspense } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { createClient } from "@/lib/supabase/server";

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
  const { from = startOfYear(), to = today() } = await searchParams;

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const { data: rows } = await supabase
    .schema("reporting")
    .from("v_currency_exchange_history")
    .select("*")
    .eq("company_id", companyId)
    .gte("rate_date", from)
    .lte("rate_date", to)
    .order("rate_date", { ascending: false });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Currency Exchange History</h1>
          <p className="text-sm text-muted-foreground">Daily exchange rates recorded from {from} to {to}.</p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename={`currency-exchange-${from}-to-${to}.csv`}
            headers={["Currency", "Date", "Rate to base", "Source"]}
            rows={(rows ?? []).map((r) => [r.currency_code, r.rate_date, r.rate_to_base, r.source])}
          />
          <PrintButton />
        </div>
      </div>

      <Suspense>
        <DateRangeFilter defaultFrom={from} defaultTo={to} />
      </Suspense>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Currency</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Rate to base</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).map((r, i) => (
            <TableRow key={`${r.currency_code}-${r.rate_date}-${i}`}>
              <TableCell>{r.currency_code}</TableCell>
              <TableCell>{r.rate_date}</TableCell>
              <TableCell className="text-right">{r.rate_to_base}</TableCell>
              <TableCell className="capitalize">{r.source}</TableCell>
            </TableRow>
          ))}
          {(rows ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No exchange rates recorded in this period.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
