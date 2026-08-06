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

export default async function PurchaseReportPage({
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
    .from("v_purchase_report")
    .select("*")
    .eq("company_id", companyId)
    .gte("purchase_date", from)
    .lte("purchase_date", to)
    .order("purchase_date", { ascending: false });

  const totalAmount = (rows ?? []).reduce((sum, r) => sum + r.gross, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase Report</h1>
          <p className="text-sm text-muted-foreground">Property purchases from {from} to {to}.</p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename={`purchase-report-${from}-to-${to}.csv`}
            headers={["Voucher No", "Date", "Asset", "Supplier", "Gross", "Currency", "Status"]}
            rows={(rows ?? []).map((r) => [
              r.voucher_no ?? "",
              r.purchase_date,
              `${r.asset_code} - ${r.asset_name}`,
              r.supplier_name,
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
            <TableHead>Asset</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).map((r) => (
            <TableRow key={r.purchase_voucher_id}>
              <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
              <TableCell>{r.purchase_date}</TableCell>
              <TableCell>
                {r.asset_code} — {r.asset_name}
              </TableCell>
              <TableCell>{r.supplier_name}</TableCell>
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
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No purchases in this period.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {(rows ?? []).length > 0 && (
          <tfoot>
            <TableRow>
              <TableCell colSpan={4} className="font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-medium">{totalAmount.toLocaleString()}</TableCell>
              <TableCell />
            </TableRow>
          </tfoot>
        )}
      </Table>
    </div>
  );
}
