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
import { createClient } from "@/lib/supabase/server";

function startOfYear() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

interface AccountBalance {
  account_code: string;
  account_name: string;
  balance: number;
}

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from = startOfYear(), to = today() } = await searchParams;

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const { data: lines } = await supabase
    .schema("reporting")
    .from("v_ledger_entries")
    .select("account_id, account_code, account_name, account_type, debit_amount, credit_amount")
    .eq("company_id", companyId)
    .in("account_type", ["income", "expense"])
    .gte("entry_date", from)
    .lte("entry_date", to);

  const byAccount = new Map<
    string,
    { account_code: string; account_name: string; account_type: string; debit: number; credit: number }
  >();
  for (const l of lines ?? []) {
    const existing = byAccount.get(l.account_id) ?? {
      account_code: l.account_code,
      account_name: l.account_name,
      account_type: l.account_type,
      debit: 0,
      credit: 0,
    };
    existing.debit += l.debit_amount;
    existing.credit += l.credit_amount;
    byAccount.set(l.account_id, existing);
  }

  const income: AccountBalance[] = [];
  const expense: AccountBalance[] = [];
  for (const a of byAccount.values()) {
    if (a.account_type === "income") {
      const balance = a.credit - a.debit;
      if (balance !== 0) income.push({ account_code: a.account_code, account_name: a.account_name, balance });
    } else {
      const balance = a.debit - a.credit;
      if (balance !== 0) expense.push({ account_code: a.account_code, account_name: a.account_name, balance });
    }
  }
  income.sort((a, b) => a.account_code.localeCompare(b.account_code));
  expense.sort((a, b) => a.account_code.localeCompare(b.account_code));

  const totalIncome = income.reduce((s, r) => s + r.balance, 0);
  const totalExpense = expense.reduce((s, r) => s + r.balance, 0);
  const netProfit = totalIncome - totalExpense;

  const exportRows = [
    ...income.map((r) => ({ ...r, section: "Income" })),
    ...expense.map((r) => ({ ...r, section: "Expense" })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profit &amp; Loss</h1>
          <p className="text-sm text-muted-foreground">
            Income vs. expense for {from} to {to}.
          </p>
        </div>
        <div className="flex gap-2">
          <CsvExportButton
            filename={`profit-and-loss-${from}-to-${to}.csv`}
            rows={exportRows}
            columns={[
              { header: "Section", accessor: (r) => r.section },
              { header: "Code", accessor: (r) => r.account_code },
              { header: "Name", accessor: (r) => r.account_name },
              { header: "Amount", accessor: (r) => r.balance },
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
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-muted/50">
            <TableCell colSpan={2} className="font-semibold">
              Income
            </TableCell>
          </TableRow>
          {income.map((r) => (
            <TableRow key={r.account_code}>
              <TableCell className="pl-6">
                <span className="mr-2 font-mono text-xs text-muted-foreground">{r.account_code}</span>
                {r.account_name}
              </TableCell>
              <TableCell className="text-right">{r.balance.toLocaleString()}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-medium">Total income</TableCell>
            <TableCell className="text-right font-medium">{totalIncome.toLocaleString()}</TableCell>
          </TableRow>

          <TableRow className="bg-muted/50">
            <TableCell colSpan={2} className="font-semibold">
              Expense
            </TableCell>
          </TableRow>
          {expense.map((r) => (
            <TableRow key={r.account_code}>
              <TableCell className="pl-6">
                <span className="mr-2 font-mono text-xs text-muted-foreground">{r.account_code}</span>
                {r.account_name}
              </TableCell>
              <TableCell className="text-right">{r.balance.toLocaleString()}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-medium">Total expense</TableCell>
            <TableCell className="text-right font-medium">{totalExpense.toLocaleString()}</TableCell>
          </TableRow>

          <TableRow className="border-t-2">
            <TableCell className="font-semibold">Net profit / (loss)</TableCell>
            <TableCell className={`text-right font-semibold ${netProfit >= 0 ? "text-success" : "text-destructive"}`}>
              {netProfit.toLocaleString()}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
