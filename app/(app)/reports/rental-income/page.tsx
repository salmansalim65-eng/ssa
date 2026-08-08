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
import { PrintButton } from "@/components/vouchers/print-button";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
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
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from = startOfYear(), to = today() } = await searchParams;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const { data: rows } = await supabase
    .schema("reporting")
    .from("v_rental_income")
    .select("*")
    .eq("company_id", companyId)
    .gte("invoice_date", from)
    .lte("invoice_date", to)
    .order("invoice_date", { ascending: false });

  const totalAmount = (rows ?? []).reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Rental Income"
        description={`Posted UAE and Pakistan rent invoices from ${formatDate(from)} to ${formatDate(to)}.`}
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
                r.amount,
                r.outstanding_balance,
                r.currency_code,
              ])}
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
                  <span className="font-mono text-xs text-muted-foreground">{r.asset_code}</span> —{" "}
                  <span className="font-medium">{r.asset_name}</span>
                </TableCell>
                <TableCell>{r.tenant_name}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatMoney(r.amount)} {r.currency_code}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(r.outstanding_balance)}</TableCell>
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
                <TableCell className="text-right font-mono font-medium tabular-nums">{formatMoney(totalAmount)}</TableCell>
                <TableCell />
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}
