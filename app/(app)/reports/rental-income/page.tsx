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

export default async function RentalIncomePage({
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
    .from("v_rental_income")
    .select("*")
    .eq("company_id", companyId)
    .gte("invoice_date", from)
    .lte("invoice_date", to)
    .order("invoice_date", { ascending: false });

  const totalAmount = (rows ?? []).reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rental Income</h1>
          <p className="text-sm text-muted-foreground">
            Posted UAE and Pakistan rent invoices from {from} to {to}.
          </p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename={`rental-income-${from}-to-${to}.csv`}
            rows={rows ?? []}
            columns={[
              { header: "Country", accessor: (r) => r.country },
              { header: "Voucher No", accessor: (r) => r.voucher_no ?? "" },
              { header: "Date", accessor: (r) => r.invoice_date },
              { header: "Asset", accessor: (r) => `${r.asset_code} - ${r.asset_name}` },
              { header: "Tenant", accessor: (r) => r.tenant_name },
              { header: "Amount", accessor: (r) => r.amount },
              { header: "Outstanding", accessor: (r) => r.outstanding_balance },
              { header: "Currency", accessor: (r) => r.currency_code },
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
              <TableCell>{r.invoice_date}</TableCell>
              <TableCell>
                {r.asset_code} — {r.asset_name}
              </TableCell>
              <TableCell>{r.tenant_name}</TableCell>
              <TableCell className="text-right">
                {r.amount.toLocaleString()} {r.currency_code}
              </TableCell>
              <TableCell className="text-right">{r.outstanding_balance.toLocaleString()}</TableCell>
            </TableRow>
          ))}
          {(rows ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No rental income in this period.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {(rows ?? []).length > 0 && (
          <tfoot>
            <TableRow>
              <TableCell colSpan={5} className="font-medium">
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
