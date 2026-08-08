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
import { AsOfDateFilter } from "@/components/reports/as-of-date-filter";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { PrintButton } from "@/components/vouchers/print-button";
import { aggregateByAccount } from "@/lib/reports/account-aggregation";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const { asOf = today() } = await searchParams;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const { data: lines } = await supabase
    .schema("reporting")
    .from("v_ledger_entries")
    .select("account_id, account_code, account_name, account_type, debit_amount, credit_amount")
    .eq("company_id", companyId)
    .lte("entry_date", asOf);

  const byAccount = aggregateByAccount(lines ?? []);

  const rows = Array.from(byAccount.values())
    .map((a) => {
      const net = a.debit - a.credit;
      return {
        account_code: a.account_code,
        account_name: a.account_name,
        account_type: a.account_type,
        debit: net > 0 ? net : 0,
        credit: net < 0 ? -net : 0,
      };
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => a.account_code.localeCompare(b.account_code));

  const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
  const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Trial Balance"
        description={`Net debit/credit position per account as of ${formatDate(asOf)}.`}
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`trial-balance-${asOf}.csv`}
              headers={["Code", "Name", "Type", "Debit", "Credit"]}
              rows={rows.map((r) => [r.account_code, r.account_name, r.account_type, r.debit, r.credit])}
            />
            <PrintButton />
          </>
        }
      />

      <Suspense>
        <AsOfDateFilter defaultAsOf={asOf} />
      </Suspense>

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.account_code}>
                <TableCell className="font-mono text-xs text-muted-foreground">{r.account_code}</TableCell>
                <TableCell className="font-medium">{r.account_name}</TableCell>
                <TableCell className="capitalize">{r.account_type}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.debit ? formatMoney(r.debit) : ""}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.credit ? formatMoney(r.credit) : ""}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No posted transactions as of this date.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {rows.length > 0 && (
            <tfoot className="border-t bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="font-medium">
                  Total
                </TableCell>
                <TableCell
                  className={`text-right font-mono font-medium tabular-nums ${totalDebit !== totalCredit ? "text-destructive" : ""}`}
                >
                  {formatMoney(totalDebit)}
                </TableCell>
                <TableCell
                  className={`text-right font-mono font-medium tabular-nums ${totalDebit !== totalCredit ? "text-destructive" : ""}`}
                >
                  {formatMoney(totalCredit)}
                </TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}
