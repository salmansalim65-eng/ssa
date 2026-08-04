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
import type { AccountType } from "@/types/database.types";

function today() {
  return new Date().toISOString().slice(0, 10);
}

interface AccountBalance {
  account_code: string;
  account_name: string;
  balance: number;
}

function sectionRows(title: string, rows: AccountBalance[]) {
  return (
    <>
      <TableRow className="bg-muted/50">
        <TableCell colSpan={2} className="font-semibold">
          {title}
        </TableCell>
      </TableRow>
      {rows.map((r) => (
        <TableRow key={r.account_code}>
          <TableCell className="pl-6">
            <span className="mr-2 font-mono text-xs text-muted-foreground">{r.account_code}</span>
            {r.account_name}
          </TableCell>
          <TableCell className="text-right">{r.balance.toLocaleString()}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default async function BalanceSheetPage({
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

  const buckets: Record<AccountType, AccountBalance[]> = {
    asset: [],
    liability: [],
    equity: [],
    income: [],
    expense: [],
  };

  for (const a of byAccount.values()) {
    const isDebitNormal = a.account_type === "asset" || a.account_type === "expense";
    const balance = isDebitNormal ? a.debit - a.credit : a.credit - a.debit;
    if (balance === 0) continue;
    buckets[a.account_type as AccountType].push({ account_code: a.account_code, account_name: a.account_name, balance });
  }

  for (const list of Object.values(buckets)) list.sort((a, b) => a.account_code.localeCompare(b.account_code));

  const sum = (rows: AccountBalance[]) => rows.reduce((s, r) => s + r.balance, 0);
  const assetTotal = sum(buckets.asset);
  const liabilityTotal = sum(buckets.liability);
  const equityTotal = sum(buckets.equity);
  const incomeTotal = sum(buckets.income);
  const expenseTotal = sum(buckets.expense);
  const netProfit = incomeTotal - expenseTotal;
  const equityAndProfitTotal = equityTotal + netProfit;
  const liabilitiesAndEquityTotal = liabilityTotal + equityAndProfitTotal;

  const exportRows = [
    ...buckets.asset.map((r) => ({ ...r, section: "Asset" })),
    ...buckets.liability.map((r) => ({ ...r, section: "Liability" })),
    ...buckets.equity.map((r) => ({ ...r, section: "Equity" })),
    { account_code: "", account_name: "Current period profit/(loss)", balance: netProfit, section: "Equity" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Balance Sheet</h1>
          <p className="text-sm text-muted-foreground">Assets, liabilities, and equity as of {asOf}.</p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename={`balance-sheet-${asOf}.csv`}
            headers={["Section", "Code", "Name", "Balance"]}
            rows={exportRows.map((r) => [r.section, r.account_code, r.account_name, r.balance])}
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
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sectionRows("Assets", buckets.asset)}
          <TableRow>
            <TableCell className="font-medium">Total assets</TableCell>
            <TableCell className="text-right font-medium">{assetTotal.toLocaleString()}</TableCell>
          </TableRow>

          {sectionRows("Liabilities", buckets.liability)}
          <TableRow>
            <TableCell className="font-medium">Total liabilities</TableCell>
            <TableCell className="text-right font-medium">{liabilityTotal.toLocaleString()}</TableCell>
          </TableRow>

          {sectionRows("Equity", buckets.equity)}
          <TableRow>
            <TableCell className="pl-6">Current period profit/(loss)</TableCell>
            <TableCell className="text-right">{netProfit.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Total equity</TableCell>
            <TableCell className="text-right font-medium">{equityAndProfitTotal.toLocaleString()}</TableCell>
          </TableRow>

          <TableRow className="border-t-2">
            <TableCell className="font-semibold">Total liabilities + equity</TableCell>
            <TableCell
              className={`text-right font-semibold ${assetTotal !== liabilitiesAndEquityTotal ? "text-destructive" : ""}`}
            >
              {liabilitiesAndEquityTotal.toLocaleString()}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
