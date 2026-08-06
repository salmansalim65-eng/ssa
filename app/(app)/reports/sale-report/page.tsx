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
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { createClient } from "@/lib/supabase/server";

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
  const { from = startOfYear(), to = today() } = await searchParams;

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

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
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sale Report</h1>
          <p className="text-sm text-muted-foreground">Asset disposals from {from} to {to}.</p>
        </div>
        <div className="flex gap-2">
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
        </div>
      </div>

      <Suspense>
        <DateRangeFilter defaultFrom={from} defaultTo={to} />
      </Suspense>

      <Table>
        <TableHeader>
          <TableRow>
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
              <TableCell>{r.sale_date}</TableCell>
              <TableCell>
                {r.asset_code ? `${r.asset_code} — ` : ""}
                {r.asset_name}
              </TableCell>
              <TableCell className="text-right">
                {r.gross.toLocaleString()} {r.currency_code}
              </TableCell>
              <TableCell>
                <VoucherStatusBadge status={r.status} />
              </TableCell>
            </TableRow>
          ))}
          {(rows ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No sales in this period.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {(rows ?? []).length > 0 && (
          <tfoot>
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-medium">{totalGross.toLocaleString()}</TableCell>
              <TableCell />
            </TableRow>
          </tfoot>
        )}
      </Table>
    </div>
  );
}
