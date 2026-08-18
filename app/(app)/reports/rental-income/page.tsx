import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
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
import { ReportSelectFilter } from "@/components/reports/report-select-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { convertAtBookingRate, resolveReportCurrency } from "@/lib/reports/report-currency";
import { loadAccountingPeriodStart } from "@/lib/reports/period";
import { formatDate, formatMoney } from "@/lib/format";

function startOfYear() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default async function RentalIncomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; cur?: string }>;
}) {
  const { from: spFrom, to = today(), cur = "" } = await searchParams;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const periodStart = await loadAccountingPeriodStart(companyId);
  const from = spFrom ?? periodStart ?? startOfYear();

  const [{ data: rows }, currency] = await Promise.all([
    supabase
      .schema("reporting")
      .from("v_rental_income")
      .select("*")
      .eq("company_id", companyId)
      .gte("invoice_date", from)
      .lte("invoice_date", to)
      .order("invoice_date", { ascending: false }),
    resolveReportCurrency(companyId, cur, to),
  ]);

  // Convert each invoice with its OWN booking rate for the document→base leg, then
  // base→selected at the report-date factor. So the base view shows the exact
  // posted base amounts.
  const { factor, symbol } = currency;
  const money = (n: number) => (symbol ? `${symbol} ${formatMoney(n)}` : formatMoney(n));
  const convert = (amount: number, rate: number) => convertAtBookingRate(amount, rate, factor);
  const totalAmount = (rows ?? []).reduce((sum, r) => sum + convert(r.amount, r.exchange_rate), 0);
  const totalOutstanding = (rows ?? []).reduce((sum, r) => sum + convert(r.outstanding_balance, r.exchange_rate), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Rental Income"
        description={`Posted UAE and Pakistan rent invoices from ${formatDate(from)} to ${formatDate(to)}. Amounts in ${
          currency.selectedCode || "base currency"
        }.`}
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`rental-income-${from}-to-${to}.csv`}
              headers={["Country", "Voucher No", "Date", "Asset", "Tenant", "Amount", "Outstanding", "Currency"]}
              rows={(rows ?? []).map((r) => [
                r.country,
                r.voucher_no ?? "",
                r.invoice_date,
                `${r.asset_code} - ${r.asset_name}`,
                r.tenant_name,
                convert(r.amount, r.exchange_rate),
                convert(r.outstanding_balance, r.exchange_rate),
                currency.selectedCode,
              ])}
            />
            <PrintButton />
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Suspense>
          <DateRangeFilter defaultFrom={from} defaultTo={to} />
        </Suspense>
        <Suspense>
          <ReportSelectFilter
            label="Currency"
            param="cur"
            allLabel={currency.baseCode ? `Base (${currency.baseCode})` : "Base"}
            options={currency.options}
            selected={cur}
            width="w-40"
          />
        </Suspense>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Country</TableHead>
              <TableHead>Voucher No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead>Tenant</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((r) => (
              <TableRow key={r.invoice_id}>
                <TableCell>
                  <Badge variant="outline">{r.country}</Badge>
                </TableCell>
                <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
                <TableCell>{formatDate(r.invoice_date)}</TableCell>
                <TableCell>
                  <span className="font-medium">{r.asset_name}</span>
                </TableCell>
                <TableCell>{r.tenant_name}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {money(convert(r.amount, r.exchange_rate))}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {money(convert(r.outstanding_balance, r.exchange_rate))}
                </TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No rental income in this period.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {(rows ?? []).length > 0 && (
            <tfoot className="border-t bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">{money(totalAmount)}</TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">{money(totalOutstanding)}</TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}
