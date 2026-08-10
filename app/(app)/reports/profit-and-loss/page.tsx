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
import { ReportCountryFilter } from "@/components/reports/report-country-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { loadReportCountries } from "@/lib/reports/countries";
import { formatDate, formatMoney } from "@/lib/format";

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
  searchParams: Promise<{ from?: string; to?: string; country?: string }>;
}) {
  const { from = startOfYear(), to = today(), country = "" } = await searchParams;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  let linesQuery = supabase
    .schema("reporting")
    .from("v_ledger_entries")
    .select("account_id, account_code, account_name, account_type, debit_amount, credit_amount")
    .eq("company_id", companyId)
    .in("account_type", ["income", "expense"])
    .gte("entry_date", from)
    .lte("entry_date", to);
  if (country) linesQuery = linesQuery.eq("cost_center_country", country);
  const [{ data: lines }, countries] = await Promise.all([linesQuery, loadReportCountries(companyId)]);
  const countryName = country ? countries.find((c) => c.code === country)?.name ?? country : "";

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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Profit & Loss"
        description={`Income vs. expense for ${formatDate(from)} to ${formatDate(to)}${
          countryName ? ` · ${countryName}` : ""
        }.`}
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`profit-and-loss-${from}-to-${to}.csv`}
              headers={["Section", "Code", "Name", "Amount"]}
              rows={exportRows.map((r) => [r.section, r.account_code, r.account_name, r.balance])}
            />
            <PrintButton />
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Suspense>
          <DateRangeFilter defaultFrom={from} defaultTo={to} />
        </Suspense>
        <Suspense>
          <ReportCountryFilter countries={countries} selected={country} />
        </Suspense>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
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
                  <span className="font-medium">{r.account_name}</span>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(r.balance)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium">Total income</TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">{formatMoney(totalIncome)}</TableCell>
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
                  <span className="font-medium">{r.account_name}</span>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(r.balance)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium">Total expense</TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">{formatMoney(totalExpense)}</TableCell>
            </TableRow>

            <TableRow className="border-t-2">
              <TableCell className="font-semibold">Net profit / (loss)</TableCell>
              <TableCell
                className={`text-right font-mono font-semibold tabular-nums ${netProfit >= 0 ? "text-success" : "text-destructive"}`}
              >
                {formatMoney(netProfit)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
