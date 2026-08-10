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
import { ReportSelectFilter } from "@/components/reports/report-select-filter";
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
  debit: number;
  credit: number;
  /** Positive amount in the account's natural direction (income: credit-debit;
   * expense: debit-credit) — what the Amount column and section totals sum. */
  balance: number;
}

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; country?: string; cc?: string; cur?: string }>;
}) {
  const { from = startOfYear(), to = today(), country = "", cc = "", cur = "" } = await searchParams;

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
  if (cc) linesQuery = linesQuery.eq("cost_center_id", cc);
  const [{ data: lines }, countries, { data: companyCurrencies }, { data: costCenters }] = await Promise.all([
    linesQuery,
    loadReportCountries(companyId),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("is_base_currency, currencies:currency_id(id, code, symbol)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name"),
  ]);
  const countryName = country ? countries.find((c) => c.code === country)?.name ?? country : "";
  const costCenterOptions = (costCenters ?? []).map((c) => ({ value: c.id, label: c.name }));

  // Company currencies (base first). Ledger amounts are stored in base currency;
  // choosing another currency converts every figure at that currency's rate as
  // of the report's "to" date.
  type RawCurrency = { is_base_currency: boolean; currencies: { id: string; code: string; symbol: string } | null };
  const currencyList = ((companyCurrencies as unknown as RawCurrency[]) ?? []).filter((c) => c.currencies);
  const baseCurrency = currencyList.find((c) => c.is_base_currency)?.currencies ?? null;
  const currencyOptions = currencyList
    .map((c) => ({ value: c.currencies!.id, label: c.currencies!.code }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const selectedCurrencyId = cur || baseCurrency?.id || "";
  const selectedCurrency = currencyList.find((c) => c.currencies!.id === selectedCurrencyId)?.currencies ?? baseCurrency;

  // Conversion factor base -> selected currency at the "to" date. No rate
  // configured (or base selected) leaves amounts in base rather than failing.
  let factor = 1;
  if (selectedCurrencyId && baseCurrency && selectedCurrencyId !== baseCurrency.id) {
    const { data: rate, error } = await supabase.schema("core").rpc("fn_exchange_rate_to_base", {
      p_company_id: companyId,
      p_currency_id: selectedCurrencyId,
      p_as_of_date: to,
    });
    if (!error && rate) factor = 1 / (rate as number);
  }

  const symbol = selectedCurrency?.symbol ?? selectedCurrency?.code ?? "";
  // `SYMBOL 1,234` — currency symbol before a thousands-separated amount. The
  // Income/Expense section headers already convey the Dr/Cr direction, and each
  // account's raw debits/credits show in their own columns.
  const money = (n: number) => (symbol ? `${symbol} ${formatMoney(n)}` : formatMoney(n));

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
    const debit = a.debit * factor;
    const credit = a.credit * factor;
    if (a.account_type === "income") {
      const balance = credit - debit;
      if (balance !== 0)
        income.push({ account_code: a.account_code, account_name: a.account_name, debit, credit, balance });
    } else {
      const balance = debit - credit;
      if (balance !== 0)
        expense.push({ account_code: a.account_code, account_name: a.account_name, debit, credit, balance });
    }
  }
  income.sort((a, b) => a.account_code.localeCompare(b.account_code));
  expense.sort((a, b) => a.account_code.localeCompare(b.account_code));

  const sumDebit = (rows: AccountBalance[]) => rows.reduce((s, r) => s + r.debit, 0);
  const sumCredit = (rows: AccountBalance[]) => rows.reduce((s, r) => s + r.credit, 0);
  const totalIncome = income.reduce((s, r) => s + r.balance, 0);
  const totalExpense = expense.reduce((s, r) => s + r.balance, 0);
  const netProfit = totalIncome - totalExpense;

  const exportRows = [
    ...income.map((r) => ({ ...r, section: "Income" })),
    ...expense.map((r) => ({ ...r, section: "Expense" })),
  ];

  // Dark navy treatment (same tokens as the column headers) for the subtotal /
  // total rows, matching the Balance Sheet and Trial Balance.
  const totalRow = "bg-header text-header-foreground hover:bg-header [&>td]:border-header-border";

  function accountRows(rows: AccountBalance[]) {
    return rows.map((r) => (
      <TableRow key={r.account_code}>
        <TableCell className="pl-6">
          <span className="mr-2 font-mono text-xs text-muted-foreground">{r.account_code}</span>
          <span className="font-medium">{r.account_name}</span>
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">{r.debit ? money(r.debit) : ""}</TableCell>
        <TableCell className="text-right font-mono tabular-nums">{r.credit ? money(r.credit) : ""}</TableCell>
        <TableCell className="text-right font-mono tabular-nums">{money(r.balance)}</TableCell>
      </TableRow>
    ));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Profit & Loss"
        description={`Income vs. expense for ${formatDate(from)} to ${formatDate(to)}${
          countryName ? ` · ${countryName}` : ""
        }. Amounts in ${selectedCurrency?.code ?? "base currency"}.`}
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`profit-and-loss-${from}-to-${to}.csv`}
              headers={["Section", "Code", "Name", "Debit", "Credit", "Amount"]}
              rows={exportRows.map((r) => [r.section, r.account_code, r.account_name, r.debit, r.credit, r.balance])}
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
          <ReportCountryFilter countries={countries} selected={country} currencyOptions={currencyOptions} />
        </Suspense>
        <Suspense>
          <ReportSelectFilter
            label="Cost centre"
            param="cc"
            allLabel="All cost centres"
            options={costCenterOptions}
            selected={cc}
          />
        </Suspense>
        <Suspense>
          <ReportSelectFilter
            label="Currency"
            param="cur"
            allLabel={baseCurrency ? `Base (${baseCurrency.code})` : "Base"}
            options={currencyOptions}
            selected={cur}
            width="w-40"
          />
        </Suspense>
        <Suspense>
          <ReportSelectFilter
            label="Cost centre"
            param="cc"
            allLabel="All cost centres"
            options={costCenterOptions}
            selected={cc}
          />
        </Suspense>
        <Suspense>
          <ReportSelectFilter
            label="Currency"
            param="cur"
            allLabel={baseCurrency ? `Base (${baseCurrency.code})` : "Base"}
            options={currencyOptions}
            selected={cur}
            width="w-40"
          />
        </Suspense>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableCell colSpan={4} className="font-semibold">
                Income
              </TableCell>
            </TableRow>
            {accountRows(income)}
            <TableRow className={totalRow}>
              <TableCell className="font-medium">Total income</TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">{money(sumDebit(income))}</TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">{money(sumCredit(income))}</TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">{money(totalIncome)}</TableCell>
            </TableRow>

            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableCell colSpan={4} className="font-semibold">
                Expense
              </TableCell>
            </TableRow>
            {accountRows(expense)}
            <TableRow className={totalRow}>
              <TableCell className="font-medium">Total expense</TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">{money(sumDebit(expense))}</TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">{money(sumCredit(expense))}</TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">{money(totalExpense)}</TableCell>
            </TableRow>

            <TableRow className={totalRow}>
              <TableCell colSpan={3} className="font-semibold">
                Net profit / (loss)
              </TableCell>
              <TableCell
                className={`text-right font-mono font-semibold tabular-nums ${netProfit >= 0 ? "text-success" : "text-destructive"}`}
              >
                {money(netProfit)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
