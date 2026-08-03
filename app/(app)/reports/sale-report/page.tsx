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

  const totalSalePrice = (rows ?? []).reduce((sum, r) => sum + r.sale_price, 0);
  const totalProfitLoss = (rows ?? []).reduce((sum, r) => sum + r.profit_loss_amount, 0);

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
            rows={rows ?? []}
            columns={[
              { header: "Voucher No", accessor: (r) => r.voucher_no ?? "" },
              { header: "Date", accessor: (r) => r.sale_date },
              { header: "Asset", accessor: (r) => `${r.asset_code} - ${r.asset_name}` },
              { header: "Buyer", accessor: (r) => r.buyer },
              { header: "Sale Price", accessor: (r) => r.sale_price },
              { header: "Book Value", accessor: (r) => r.book_value_at_sale },
              { header: "Profit/Loss", accessor: (r) => r.profit_loss_amount },
              { header: "Capital Gain", accessor: (r) => r.capital_gain_amount },
              { header: "Currency", accessor: (r) => r.currency_code },
              { header: "Status", accessor: (r) => r.status },
            ]}
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
            <TableHead>Buyer</TableHead>
            <TableHead className="text-right">Sale price</TableHead>
            <TableHead className="text-right">Profit/Loss</TableHead>
            <TableHead className="text-right">Capital gain</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).map((r) => (
            <TableRow key={r.sale_id}>
              <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
              <TableCell>{r.sale_date}</TableCell>
              <TableCell>
                {r.asset_code} — {r.asset_name}
              </TableCell>
              <TableCell>{r.buyer}</TableCell>
              <TableCell className="text-right">
                {r.sale_price.toLocaleString()} {r.currency_code}
              </TableCell>
              <TableCell className={`text-right ${r.profit_loss_amount >= 0 ? "text-success" : "text-destructive"}`}>
                {r.profit_loss_amount.toLocaleString()}
              </TableCell>
              <TableCell className={`text-right ${r.capital_gain_amount >= 0 ? "text-success" : "text-destructive"}`}>
                {r.capital_gain_amount.toLocaleString()}
              </TableCell>
              <TableCell>
                <VoucherStatusBadge status={r.status} />
              </TableCell>
            </TableRow>
          ))}
          {(rows ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                No sales in this period.
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
              <TableCell className="text-right font-medium">{totalSalePrice.toLocaleString()}</TableCell>
              <TableCell className={`text-right font-medium ${totalProfitLoss >= 0 ? "text-success" : "text-destructive"}`}>
                {totalProfitLoss.toLocaleString()}
              </TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </tfoot>
        )}
      </Table>
    </div>
  );
}
