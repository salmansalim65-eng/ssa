import { Suspense } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AsOfDateFilter } from "@/components/reports/as-of-date-filter";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { PrintButton } from "@/components/vouchers/print-button";
import { aggregateByAccount } from "@/lib/reports/account-aggregation";
import { createClient } from "@/lib/supabase/server";

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
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

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
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trial Balance</h1>
          <p className="text-sm text-muted-foreground">Net debit/credit position per account as of {asOf}.</p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename={`trial-balance-${asOf}.csv`}
            rows={rows}
            columns={[
              { header: "Code", accessor: (r) => r.account_code },
              { header: "Name", accessor: (r) => r.account_name },
              { header: "Type", accessor: (r) => r.account_type },
              { header: "Debit", accessor: (r) => r.debit },
              { header: "Credit", accessor: (r) => r.credit },
            ]}
          />
          <PrintButton />
        </div>
      </div>

      <Suspense>
        <AsOfDateFilter defaultAsOf={asOf} />
      </Suspense>

      <Table>
        <TableHeader>
          <TableRow>
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
              <TableCell className="font-mono">{r.account_code}</TableCell>
              <TableCell>{r.account_name}</TableCell>
              <TableCell className="capitalize">{r.account_type}</TableCell>
              <TableCell className="text-right">{r.debit ? r.debit.toLocaleString() : ""}</TableCell>
              <TableCell className="text-right">{r.credit ? r.credit.toLocaleString() : ""}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No posted transactions as of this date.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {rows.length > 0 && (
          <tfoot>
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                Total
              </TableCell>
              <TableCell className={`text-right font-medium ${totalDebit !== totalCredit ? "text-destructive" : ""}`}>
                {totalDebit.toLocaleString()}
              </TableCell>
              <TableCell className={`text-right font-medium ${totalDebit !== totalCredit ? "text-destructive" : ""}`}>
                {totalCredit.toLocaleString()}
              </TableCell>
            </TableRow>
          </tfoot>
        )}
      </Table>
    </div>
  );
}
