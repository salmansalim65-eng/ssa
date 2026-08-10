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
import { resolveRentalReportCurrency } from "@/lib/reports/report-currency";
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
    resolveRentalReportCurrency(companyId, cur, today()),
  ]);

  // Convert every row's document-currency balance to the selected report currency.
  const { convert, symbol } = currency;
  const money = (n: number) => (symbol ? `${symbol} ${formatMoney(n)}` : formatMoney(n));
  const totalOutstanding = (rows ?? []).reduce((sum, r) => sum + convert(r.outstanding_balance, r.currency_code), 0);

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
              headers={["Country", "Voucher No", "Due Date", "Asset", "Tenant", "Outstanding", "Currency", "Days Overdue"]}
              rows={(rows ?? []).map((r) => [
                r.country,
                r.voucher_no ?? "",
                r.due_date,
                `${r.asset_code} - ${r.asset_name}`,
                r.tenant_name,
                convert(r.outstanding_balance, r.currency_code),
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
            {(rows ?? []).map((r) => (
              <TableRow key={r.invoice_id}>
                <TableCell>
                  <Badge variant="outline">{r.country}</Badge>
                </TableCell>
                <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
                <TableCell>{formatDate(r.due_date)}</TableCell>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{r.asset_code}</span> —{" "}
                  <span className="font-medium">{r.asset_name}</span>
                </TableCell>
                <TableCell>{r.tenant_name}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {money(convert(r.outstanding_balance, r.currency_code))}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${r.days_overdue > 0 ? "text-destructive" : ""}`}>
                  {r.days_overdue > 0 ? r.days_overdue : 0}
                </TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No outstanding rent.
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
