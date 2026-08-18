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
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { loadAccountingPeriodStart } from "@/lib/reports/period";
import { formatDate, formatMoney } from "@/lib/format";

function startOfYear() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default async function SaleReportPage({
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
    .from("v_sale_report")
    .select("*")
    .eq("company_id", companyId)
    .gte("sale_date", from)
    .lte("sale_date", to)
    .order("sale_date", { ascending: false });

  const totalGross = (rows ?? []).reduce((sum, r) => sum + r.gross, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Sale Report"
        description={`Asset disposals from ${formatDate(from)} to ${formatDate(to)}.`}
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`sale-report-${from}-to-${to}.csv`}
              headers={["Voucher No", "Date", "Property", "Gross", "Currency", "Status"]}
              rows={(rows ?? []).map((r) => [
                r.voucher_no ?? "",
                r.sale_date,
                `${r.asset_code} - ${r.asset_name}`,
                r.gross,
                r.currency_code,
                r.status,
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
              <TableHead>Voucher No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Property</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((r) => (
              <TableRow key={r.sale_id}>
                <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
                <TableCell>{formatDate(r.sale_date)}</TableCell>
                <TableCell>
                  {r.asset_name}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatMoney(r.gross)} {r.currency_code}
                </TableCell>
                <TableCell>
                  <VoucherStatusBadge status={r.status} />
                </TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No sales in this period.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {(rows ?? []).length > 0 && (
            <tfoot className="border-t bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">{formatMoney(totalGross)}</TableCell>
                <TableCell />
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}
