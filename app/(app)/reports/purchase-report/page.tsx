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
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";

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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Purchase Report"
        description={`Property purchases from ${formatDate(from)} to ${formatDate(to)}.`}
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`purchase-report-${from}-to-${to}.csv`}
              headers={["Voucher No", "Date", "Account", "Gross", "Currency", "Status"]}
              rows={(rows ?? []).map((r) => [
                r.voucher_no ?? "",
                r.purchase_date,
                r.account_name,
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

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Voucher No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((r) => (
              <TableRow key={r.purchase_voucher_id}>
                <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
                <TableCell>{formatDate(r.purchase_date)}</TableCell>
                <TableCell className="font-medium">{r.account_name}</TableCell>
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
                  No purchases in this period.
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
