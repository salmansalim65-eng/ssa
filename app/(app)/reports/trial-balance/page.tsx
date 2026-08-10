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
import { formatDate, formatMoney } from "@/lib/format";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; country?: string; cc?: string }>;
}) {
  const { asOf = today(), country = "", cc = "" } = await searchParams;

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
      .select("is_base_currency, currencies:currency_id(code, symbol)")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .eq("is_base_currency", true)
      .maybeSingle(),
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

  // Ledger amounts are already stored in base currency (v_ledger_entries uses
  // base_debit_amount/base_credit_amount), so every figure below reads in the
  // company's base currency.
  const baseCurrency = (companyCurrencies as unknown as { currencies: { code: string; symbol: string } | null } | null)
    ?.currencies;
  const symbol = baseCurrency?.symbol ?? baseCurrency?.code ?? "";
  // `SYMBOL 1,234` — currency symbol before a thousands-separated amount.
  const money = (n: number) => (symbol ? `${symbol} ${formatMoney(n)}` : formatMoney(n));

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
        description={`Net debit/credit position per account as of ${formatDate(asOf)}${
          countryName ? ` · ${countryName}` : ""
        }. Amounts in base currency${baseCurrency?.code ? ` (${baseCurrency.code})` : ""}.`}
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

      <div className="flex flex-wrap items-end gap-3">
        <Suspense>
          <AsOfDateFilter defaultAsOf={asOf} />
        </Suspense>
        <Suspense>
          <ReportCountryFilter countries={countries} selected={country} />
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
      </div>

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
                  {r.debit ? money(r.debit) : ""}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.credit ? money(r.credit) : ""}
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
            <tfoot>
              {/* Dark navy treatment (same tokens as the column headers) so the
                  totals stand out from the account rows. */}
              <TableRow className="bg-header text-header-foreground hover:bg-header [&>td]:border-header-border">
                <TableCell colSpan={3} className="font-semibold">
                  Total
                </TableCell>
                <TableCell
                  className={`text-right font-mono font-semibold tabular-nums ${totalDebit !== totalCredit ? "text-destructive" : ""}`}
                >
                  {money(totalDebit)}
                </TableCell>
                <TableCell
                  className={`text-right font-mono font-semibold tabular-nums ${totalDebit !== totalCredit ? "text-destructive" : ""}`}
                >
                  {money(totalCredit)}
                </TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}
