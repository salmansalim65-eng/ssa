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
import { ReportSelectFilter } from "@/components/reports/report-select-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { convertAtBookingRate, resolveReportCurrency } from "@/lib/reports/report-currency";
import { formatDate, formatMoney } from "@/lib/format";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default async function OutstandingRentPage({
  searchParams,
}: {
  searchParams: Promise<{ cur?: string }>;
}) {
  const { cur = "" } = await searchParams;

  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: rows }, currency] = await Promise.all([
    supabase
      .schema("reporting")
      .from("v_outstanding_rent")
      .select("*")
      .eq("company_id", companyId)
      .order("due_date"),
    resolveReportCurrency(companyId, cur, today()),
  ]);

  // Convert each invoice with its OWN booking rate for the document→base leg, then
  // base→selected at the report-date factor.
  const { factor, symbol } = currency;
  const money = (n: number) => (symbol ? `${symbol} ${formatMoney(n)}` : formatMoney(n));
  const convert = (amount: number, rate: number) => convertAtBookingRate(amount, rate, factor);
  const totalOutstanding = (rows ?? []).reduce((sum, r) => sum + convert(r.outstanding_balance, r.exchange_rate), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Outstanding Rent"
        description={`Posted invoices with a balance still due, oldest first. Amounts in ${
          currency.selectedCode || "base currency"
        }.`}
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename="outstanding-rent.csv"
              headers={["S.No", "Country", "Voucher No", "Due Date", "Asset", "Tenant", "Outstanding", "Currency", "Days Overdue"]}
              rows={(rows ?? []).map((r, i) => [
                i + 1,
                r.country,
                r.voucher_no ?? "",
                r.due_date,
                `${r.asset_code} - ${r.asset_name}`,
                r.tenant_name,
                convert(r.outstanding_balance, r.exchange_rate),
                currency.selectedCode,
                r.days_overdue,
              ])}
            />
            <PrintButton />
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
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
              <TableHead className="w-12 text-right">S.No</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Voucher No</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead>Tenant</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="text-right">Days overdue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((r, i) => (
              <TableRow key={r.invoice_id}>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                <TableCell>
                  <Badge variant="outline">{r.country}</Badge>
                </TableCell>
                <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
                <TableCell>{formatDate(r.due_date)}</TableCell>
                <TableCell>
                  <span className="font-medium">{r.asset_name}</span>
                </TableCell>
                <TableCell>{r.tenant_name}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {money(convert(r.outstanding_balance, r.exchange_rate))}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${r.days_overdue > 0 ? "text-destructive" : ""}`}>
                  {r.days_overdue > 0 ? r.days_overdue : 0}
                </TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No outstanding rent.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {(rows ?? []).length > 0 && (
            <tfoot className="border-t bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">{money(totalOutstanding)}</TableCell>
                <TableCell />
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}
