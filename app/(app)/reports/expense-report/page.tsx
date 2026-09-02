import { Fragment, Suspense } from "react";

import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { ReportCountryFilter } from "@/components/reports/report-country-filter";
import { ReportNav } from "@/components/reports/report-nav";
import { ReportSelectFilter } from "@/components/reports/report-select-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { loadReportCountries } from "@/lib/reports/countries";
import { formatAccountCode, formatMoney } from "@/lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const UNASSIGNED = "__none__";

function monthIndex(d: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})/.exec(String(d ?? ""));
  return m ? Number(m[2]) - 1 : 0;
}

export default async function ExpenseReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; country?: string; cc?: string; cur?: string }>;
}) {
  const currentYear = new Date().getFullYear();
  const { year: yearParam = "", country = "", cc = "", cur = "" } = await searchParams;
  const year = Number(yearParam) || currentYear;
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [{ data: lines }, { data: costCenters }, { data: companyCurrencies }, countries] = await Promise.all([
    supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select("account_id, account_code, account_name, cost_center_id, debit_amount, credit_amount, entry_date")
      .eq("company_id", companyId)
      .eq("account_type", "expense")
      .gte("entry_date", from)
      .lte("entry_date", to),
    supabase
      .schema("accounting")
      .from("cost_centers")
      .select("id, name, country")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("is_base_currency, currencies:currency_id(id, code, symbol)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    loadReportCountries(companyId),
  ]);

  // Ledger amounts are stored in the base currency; picking another company
  // currency restates every figure in the report at that currency's rate as of
  // the year end. Selecting a country picks its currency along with it.
  type RawCurrency = { is_base_currency: boolean; currencies: { id: string; code: string; symbol: string } | null };
  const currencyList = ((companyCurrencies as unknown as RawCurrency[]) ?? []).filter((c) => c.currencies);
  const baseCurrency = currencyList.find((c) => c.is_base_currency)?.currencies ?? null;
  const currencyOptions = currencyList
    .map((c) => ({ value: c.currencies!.id, label: c.currencies!.code }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const selectedCurrencyId = cur || baseCurrency?.id || "";
  const selectedCurrency =
    currencyList.find((c) => c.currencies!.id === selectedCurrencyId)?.currencies ?? baseCurrency;

  // No rate configured (or base selected) leaves the figures in base rather
  // than failing the report.
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
  const money = (n: number) => (n ? `${symbol ? symbol + " " : ""}${formatMoney(n)}` : "");

  const ccById = new Map(
    (costCenters ?? []).map((c) => [c.id as string, { name: c.name as string, country: (c.country as string) ?? "" }]),
  );
  const costCenterOptions = (costCenters ?? []).map((c) => ({ value: c.id as string, label: c.name as string }));
  const countryName = country ? countries.find((c) => c.code === country)?.name ?? country : "";

  // Aggregations. Expense net = debit − credit (expenses are debit-normal).
  const accountMeta = new Map<string, { code: string; name: string }>();
  const matrix = new Map<string, Map<string, number[]>>(); // ccKey → accountId → months[12]
  const ccMonths = new Map<string, number[]>(); // ccKey → months[12] subtotal
  const ccTotal = new Map<string, number>();
  const ccNameOf = new Map<string, string>();
  const accountTotal = new Map<string, number>();
  const monthsTotals = Array(12).fill(0) as number[];
  let grand = 0;

  for (const l of lines ?? []) {
    const ccId = (l.cost_center_id as string | null) ?? null;
    const meta = ccId ? ccById.get(ccId) : undefined;
    if (country && (meta?.country ?? "") !== country) continue;
    if (cc && ccId !== cc) continue;

    const net = (Number(l.debit_amount) - Number(l.credit_amount)) * factor;
    const m = monthIndex(l.entry_date as string);
    const ccKey = ccId ?? UNASSIGNED;
    ccNameOf.set(ccKey, meta?.name ?? "Unassigned");
    accountMeta.set(l.account_id as string, {
      code: l.account_code as string,
      name: l.account_name as string,
    });

    if (!matrix.has(ccKey)) matrix.set(ccKey, new Map());
    const accMap = matrix.get(ccKey)!;
    const arr = accMap.get(l.account_id as string) ?? (Array(12).fill(0) as number[]);
    arr[m] += net;
    accMap.set(l.account_id as string, arr);

    const ccm = ccMonths.get(ccKey) ?? (Array(12).fill(0) as number[]);
    ccm[m] += net;
    ccMonths.set(ccKey, ccm);

    ccTotal.set(ccKey, (ccTotal.get(ccKey) ?? 0) + net);
    accountTotal.set(l.account_id as string, (accountTotal.get(l.account_id as string) ?? 0) + net);
    monthsTotals[m] += net;
    grand += net;
  }

  // Ordered cost-centre keys: by name, Unassigned last.
  const ccKeys = [...matrix.keys()]
    .filter((k) => Math.abs(ccTotal.get(k) ?? 0) >= 0.005)
    .sort((a, b) => {
      if (a === UNASSIGNED) return 1;
      if (b === UNASSIGNED) return -1;
      return (ccNameOf.get(a) ?? "").localeCompare(ccNameOf.get(b) ?? "");
    });

  // By-cost-centre summary (desc by total).
  const byCostCentre = ccKeys
    .map((k) => ({ key: k, name: ccNameOf.get(k) ?? "Unassigned", total: ccTotal.get(k) ?? 0 }))
    .sort((a, b) => b.total - a.total);

  // By-account summary (desc by total).
  const byAccount = [...accountTotal.entries()]
    .filter(([, t]) => Math.abs(t) >= 0.005)
    .map(([id, total]) => ({ id, ...accountMeta.get(id)!, total }))
    .sort((a, b) => b.total - a.total);

  const yearOptions = [0, 1, 2, 3, 4].map((n) => ({ value: String(currentYear - n), label: String(currentYear - n) }));

  const dash = "—";
  const thisMonth = year === currentYear ? new Date().getMonth() : -1;
  const totalCols = 15; // S.No + Account + 12 months + Total

  const exportRows = ccKeys.flatMap((k) => {
    const accMap = matrix.get(k)!;
    const accIds = [...accMap.keys()]
      .filter((id) => Math.abs(accMap.get(id)!.reduce((s, v) => s + v, 0)) >= 0.005)
      .sort((a, b) => accountMeta.get(a)!.code.localeCompare(accountMeta.get(b)!.code));
    return accIds.map((id, i) => {
      const arr = accMap.get(id)!;
      return [
        i + 1,
        ccNameOf.get(k) ?? "Unassigned",
        formatAccountCode(accountMeta.get(id)!.code),
        accountMeta.get(id)!.name,
        ...arr,
        arr.reduce((s, v) => s + v, 0),
      ];
    });
  });

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <ReportNav className="pb-1.5" />
          <Suspense>
            <ReportSelectFilter
              label="Year"
              param="year"
              allLabel={String(currentYear)}
              options={yearOptions}
              selected={yearParam}
              width="w-32"
            />
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
        <div className="flex items-center gap-2">
          <CsvExportButton
            filename={`expense-report-${year}${selectedCurrency ? `-${selectedCurrency.code}` : ""}.csv`}
            headers={["S.No", "Cost centre", "Code", "Account", ...MONTHS, "Total"]}
            rows={exportRows}
          />
          <PrintButton />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          label={`Total Expenses — ${year}${countryName ? ` · ${countryName}` : ""}${
            selectedCurrency ? ` · ${selectedCurrency.code}` : ""
          }`}
          value={`${symbol ? symbol + " " : ""}${formatMoney(grand)}`}
          sub={`${byCostCentre.length} cost centre${byCostCentre.length === 1 ? "" : "s"} · ${byAccount.length} account${byAccount.length === 1 ? "" : "s"}`}
        />
        {byCostCentre[0] && (
          <Kpi
            label="Top Cost Centre"
            value={byCostCentre[0].name}
            sub={`${symbol ? symbol + " " : ""}${formatMoney(byCostCentre[0].total)}`}
          />
        )}
        {byAccount[0] && (
          <Kpi
            label="Top Expense Account"
            value={byAccount[0].name}
            sub={`${symbol ? symbol + " " : ""}${formatMoney(byAccount[0].total)}`}
          />
        )}
      </div>

      {/* Summary tables */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SummaryTable
          title="By Cost Centre"
          head="Cost centre"
          rows={byCostCentre.map((r) => ({ label: r.name, value: r.total }))}
          money={money}
          symbol={symbol}
          grand={grand}
        />
        <SummaryTable
          title="By Account"
          head="Account"
          rows={byAccount.map((r) => ({ label: `${formatAccountCode(r.code)} — ${r.name}`, value: r.total }))}
          money={money}
          symbol={symbol}
          grand={grand}
        />
      </div>

      {/* Month-wise matrix, grouped by cost centre */}
      <div className="max-h-[72vh] overflow-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-primary text-primary-foreground [&>th]:border-r [&>th]:border-primary/40 [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide">
              <th className="sticky left-0 z-30 w-12 bg-primary text-right">S.No</th>
              <th className="sticky left-12 z-30 min-w-[240px] bg-primary text-left">Account</th>
              {MONTHS.map((m, i) => (
                <th key={m} className={cn("whitespace-nowrap text-right", i === thisMonth && "bg-white/15")}>
                  {m}
                </th>
              ))}
              <th className="whitespace-nowrap text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {ccKeys.length === 0 && (
              <tr>
                <td colSpan={totalCols} className="py-12 text-center text-muted-foreground">
                  No expenses posted for {year}.
                </td>
              </tr>
            )}
            {ccKeys.map((k) => {
              const accMap = matrix.get(k)!;
              const accIds = [...accMap.keys()]
                .filter((id) => Math.abs(accMap.get(id)!.reduce((s, v) => s + v, 0)) >= 0.005)
                .sort((a, b) => accountMeta.get(a)!.code.localeCompare(accountMeta.get(b)!.code));
              const secMonths = ccMonths.get(k) ?? (Array(12).fill(0) as number[]);
              return (
                <Fragment key={k}>
                  {/* Cost-centre band = subtotal row */}
                  <tr className="bg-ledger-dark font-semibold text-white [&>td]:px-3 [&>td]:py-2">
                    <td colSpan={2} className="sticky left-0 z-10 bg-ledger-dark text-xs uppercase tracking-wide">
                      {ccNameOf.get(k) ?? "Unassigned"}
                    </td>
                    {secMonths.map((v, i) => (
                      <td key={i} className={cn("text-right font-mono tabular-nums", i === thisMonth && "bg-white/10")}>
                        {v ? money(v) : dash}
                      </td>
                    ))}
                    <td className="text-right font-mono tabular-nums">{money(ccTotal.get(k) ?? 0)}</td>
                  </tr>
                  {accIds.map((id, ri) => {
                    const arr = accMap.get(id)!;
                    const rowBg = ri % 2 ? "bg-muted/30" : "bg-card";
                    return (
                      <tr
                        key={id}
                        className={cn("group/row border-b border-border/50 [&>td]:px-3 [&>td]:py-2", rowBg, "hover:bg-primary/[0.05]")}
                      >
                        <td className={cn("sticky left-0 z-10 w-12 border-r border-border/50 text-right font-mono text-xs tabular-nums text-muted-foreground", rowBg, "group-hover/row:bg-primary/[0.05]")}>
                          {ri + 1}
                        </td>
                        <td className={cn("sticky left-12 z-10 min-w-[240px] border-r border-border/50", rowBg, "group-hover/row:bg-primary/[0.05]")}>
                          <span className="mr-2 font-mono text-xs text-muted-foreground">
                            {formatAccountCode(accountMeta.get(id)!.code)}
                          </span>
                          <span className="font-medium">{accountMeta.get(id)!.name}</span>
                        </td>
                        {arr.map((v, i) => (
                          <td key={i} className={cn("text-right font-mono tabular-nums", i === thisMonth && "bg-primary/[0.04]")}>
                            {v ? money(v) : dash}
                          </td>
                        ))}
                        <td className="text-right font-mono font-semibold tabular-nums">{money(arr.reduce((s, v) => s + v, 0))}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            {ccKeys.length > 0 && (
              <tr className="bg-primary font-semibold text-primary-foreground [&>td]:px-3 [&>td]:py-2">
                <td colSpan={2} className="sticky left-0 z-10 bg-primary text-xs uppercase tracking-wide">
                  Grand Total
                </td>
                {monthsTotals.map((v, i) => (
                  <td key={i} className={cn("text-right font-mono tabular-nums", i === thisMonth && "bg-white/15")}>
                    {v ? money(v) : dash}
                  </td>
                ))}
                <td className="text-right font-mono tabular-nums">{money(grand)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.07] to-transparent px-4 py-3.5 shadow-xs">
      <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />
      <p className="truncate pl-1.5 text-[0.68rem] font-semibold uppercase tracking-wide text-primary">{label}</p>
      <p className="mt-1 truncate pl-1.5 font-mono text-xl font-bold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 truncate pl-1.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function SummaryTable({
  title,
  head,
  rows,
  money,
  symbol,
  grand,
}: {
  title: string;
  head: string;
  rows: { label: string; value: number }[];
  money: (n: number) => string;
  symbol: string;
  grand: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
      <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-12 text-right">S.No</TableHead>
            <TableHead>{head}</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                No expenses.
              </TableCell>
            </TableRow>
          )}
          {rows.map((r, i) => (
            <TableRow key={`${r.label}-${i}`}>
              <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
              <TableCell>{r.label}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(r.value)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        {rows.length > 0 && (
          <tfoot className="border-t bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={2} className="font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {`${symbol ? symbol + " " : ""}${formatMoney(grand)}`}
              </TableCell>
            </TableRow>
          </tfoot>
        )}
      </Table>
    </div>
  );
}
