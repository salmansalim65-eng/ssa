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
import { ReportCountryFilter } from "@/components/reports/report-country-filter";
import { ReportSelectFilter } from "@/components/reports/report-select-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { aggregateByAccount } from "@/lib/reports/account-aggregation";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { loadReportCountries } from "@/lib/reports/countries";
import { formatAccountCode, formatDate, formatMoney } from "@/lib/format";
import type { AccountType } from "@/types/database.types";

function today() {
  return new Date().toISOString().slice(0, 10);
}

interface AccountBalance {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
}

/** Net debit/credit convention: positive net (debit-heavy) is a "Dr" balance,
 * negative is a "Cr" balance. Works for every account type, so the same helper
 * labels assets (normally Dr) and liabilities/equity (normally Cr). */
function netOf(r: { debit: number; credit: number }) {
  return r.debit - r.credit;
}

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; country?: string; cc?: string; cur?: string }>;
}) {
  const { asOf = today(), country = "", cc = "", cur = "" } = await searchParams;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  let linesQuery = supabase
    .schema("reporting")
    .from("v_ledger_entries")
    .select("account_id, account_code, account_name, account_type, debit_amount, credit_amount")
    .eq("company_id", companyId)
    .lte("entry_date", asOf);
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
  // of the report's as-of date.
  type RawCurrency = { is_base_currency: boolean; currencies: { id: string; code: string; symbol: string } | null };
  const currencyList = ((companyCurrencies as unknown as RawCurrency[]) ?? []).filter((c) => c.currencies);
  const baseCurrency = currencyList.find((c) => c.is_base_currency)?.currencies ?? null;
  const currencyOptions = currencyList
    .map((c) => ({ value: c.currencies!.id, label: c.currencies!.code }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const selectedCurrencyId = cur || baseCurrency?.id || "";
  const selectedCurrency = currencyList.find((c) => c.currencies!.id === selectedCurrencyId)?.currencies ?? baseCurrency;

  // Conversion factor base -> selected currency at the as-of date. No rate
  // configured (or base selected) leaves amounts in base rather than failing.
  let factor = 1;
  if (selectedCurrencyId && baseCurrency && selectedCurrencyId !== baseCurrency.id) {
    const { data: rate, error } = await supabase.schema("core").rpc("fn_exchange_rate_to_base", {
      p_company_id: companyId,
      p_currency_id: selectedCurrencyId,
      p_as_of_date: asOf,
    });
    if (!error && rate) factor = 1 / (rate as number);
  }

  const symbol = selectedCurrency?.symbol ?? selectedCurrency?.code ?? "";
  // `SYMBOL 1,234` — currency symbol before a thousands-separated amount.
  const money = (n: number) => (symbol ? `${symbol} ${formatMoney(n)}` : formatMoney(n));
  // `SYMBOL 1,234 Dr` / `SYMBOL 1,234 Cr` from a net debit figure.
  const balanceLabel = (net: number) => `${money(Math.abs(net))} ${net >= 0 ? "Dr" : "Cr"}`;

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
    buckets[a.account_type as AccountType].push({
      account_code: a.account_code,
      account_name: a.account_name,
      debit: a.debit * factor,
      credit: a.credit * factor,
    });
  }

  for (const list of Object.values(buckets)) list.sort((a, b) => a.account_code.localeCompare(b.account_code));

  const sumDebit = (rows: AccountBalance[]) => rows.reduce((s, r) => s + r.debit, 0);
  const sumCredit = (rows: AccountBalance[]) => rows.reduce((s, r) => s + r.credit, 0);

  const assetNet = sumDebit(buckets.asset) - sumCredit(buckets.asset);
  const liabilityNet = sumCredit(buckets.liability) - sumDebit(buckets.liability);
  const equityNet = sumCredit(buckets.equity) - sumDebit(buckets.equity);
  const incomeNet = sumCredit(buckets.income) - sumDebit(buckets.income);
  const expenseNet = sumDebit(buckets.expense) - sumCredit(buckets.expense);
  const netProfit = incomeNet - expenseNet;
  const equityAndProfitNet = equityNet + netProfit;
  const liabilitiesAndEquityNet = liabilityNet + equityAndProfitNet;
  // Tolerance guards floating-point drift from currency conversion.
  const balanced = Math.abs(assetNet - liabilitiesAndEquityNet) < 0.005;

  // Synthetic profit/(loss) row: a profit is a credit to equity, a loss a debit.
  const profitRow: AccountBalance = {
    account_code: "",
    account_name: "Current period profit/(loss)",
    debit: netProfit < 0 ? -netProfit : 0,
    credit: netProfit > 0 ? netProfit : 0,
  };

  const exportRows = [
    ...buckets.asset.map((r) => ({ ...r, section: "Asset" })),
    ...buckets.liability.map((r) => ({ ...r, section: "Liability" })),
    ...buckets.equity.map((r) => ({ ...r, section: "Equity" })),
    { ...profitRow, section: "Equity" },
  ];

  function sectionRows(title: string, rows: AccountBalance[]) {
    return (
      <>
        <TableRow className="bg-muted/50 hover:bg-muted/50">
          <TableCell colSpan={4} className="font-semibold">
            {title}
          </TableCell>
        </TableRow>
        {rows.map((r) => {
          const net = netOf(r);
          return (
            <TableRow key={r.account_code}>
              <TableCell>
                <span className="mr-2 font-mono text-xs text-muted-foreground">{formatAccountCode(r.account_code)}</span>
                <span className="font-medium">{r.account_name}</span>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{r.debit ? money(r.debit) : ""}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{r.credit ? money(r.credit) : ""}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{balanceLabel(net)}</TableCell>
            </TableRow>
          );
        })}
      </>
    );
  }

  // The dark navy treatment (same tokens as the table column headers) applied to
  // every subtotal/total row so the summary figures stand out from the accounts.
  const totalRow = "bg-header text-header-foreground hover:bg-header [&>td]:border-header-border";
  function totalRowCells(label: string, debit: number, credit: number, net: number, emphatic = false) {
    const weight = emphatic ? "font-semibold" : "font-medium";
    return (
      <>
        <TableCell className={weight}>{label}</TableCell>
        <TableCell className={`text-right font-mono tabular-nums ${weight}`}>{money(debit)}</TableCell>
        <TableCell className={`text-right font-mono tabular-nums ${weight}`}>{money(credit)}</TableCell>
        <TableCell className={`text-right font-mono tabular-nums ${weight}`}>{balanceLabel(net)}</TableCell>
      </>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Balance Sheet"
        description={`Assets, liabilities, and equity as of ${formatDate(asOf)}${
          countryName ? ` · ${countryName}` : ""
        }. Amounts in ${selectedCurrency?.code ?? "base currency"}.`}
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`balance-sheet-${asOf}.csv`}
              headers={["Section", "Code", "Name", "Debit", "Credit", "Balance"]}
              rows={exportRows.map((r) => {
                const net = netOf(r);
                return [
                  r.section,
                  formatAccountCode(r.account_code),
                  r.account_name,
                  r.debit,
                  r.credit,
                  `${Math.abs(net)} ${net >= 0 ? "Dr" : "Cr"}`,
                ];
              })}
            />
            <PrintButton />
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Suspense>
          <AsOfDateFilter defaultAsOf={asOf} />
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
      </div>

      {country && (
        <p className="text-xs text-muted-foreground print:hidden">
          Country view attributes entries via their cost center; a single-country balance sheet may not
          self-balance because untagged entries and company-level equity are excluded.
        </p>
      )}

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sectionRows("Assets", buckets.asset)}
            <TableRow className={totalRow}>
              {totalRowCells("Total assets", sumDebit(buckets.asset), sumCredit(buckets.asset), assetNet)}
            </TableRow>

            {sectionRows("Liabilities", buckets.liability)}
            <TableRow className={totalRow}>
              {totalRowCells(
                "Total liabilities",
                sumDebit(buckets.liability),
                sumCredit(buckets.liability),
                liabilityNet,
              )}
            </TableRow>

            {sectionRows("Equity", buckets.equity)}
            <TableRow>
              <TableCell>Current period profit/(loss)</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {profitRow.debit ? money(profitRow.debit) : ""}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {profitRow.credit ? money(profitRow.credit) : ""}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{balanceLabel(netOf(profitRow))}</TableCell>
            </TableRow>
            <TableRow className={totalRow}>
              {totalRowCells(
                "Total equity",
                sumDebit(buckets.equity) + profitRow.debit,
                sumCredit(buckets.equity) + profitRow.credit,
                equityAndProfitNet,
              )}
            </TableRow>

            <TableRow className={totalRow}>
              {totalRowCells(
                "Total liabilities + equity",
                sumDebit(buckets.liability) + sumDebit(buckets.equity) + profitRow.debit,
                sumCredit(buckets.liability) + sumCredit(buckets.equity) + profitRow.credit,
                liabilitiesAndEquityNet,
                true,
              )}
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {!balanced && (
        <p className="text-xs font-medium text-destructive print:hidden">
          Assets ({balanceLabel(assetNet)}) do not equal liabilities + equity ({balanceLabel(liabilitiesAndEquityNet)}).
        </p>
      )}
    </div>
  );
}
