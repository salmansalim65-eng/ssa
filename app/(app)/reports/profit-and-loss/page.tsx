import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { ReportCountryFilter } from "@/components/reports/report-country-filter";
import { ReportSelectFilter } from "@/components/reports/report-select-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { loadReportCountries, equivalentCountryCodes } from "@/lib/reports/countries";
import { loadAccountingPeriodStart } from "@/lib/reports/period";
import { formatAccountCode, formatDate, formatMoney } from "@/lib/format";
import { ProfitLossTree, type PlRow } from "./profit-loss-tree";

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
  const { from: spFrom, to = today(), country = "", cc = "", cur = "" } = await searchParams;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const periodStart = await loadAccountingPeriodStart(companyId);
  const from = spFrom ?? periodStart ?? startOfYear();

  // Accounts tagged to a country (posted without a cost centre) must still show
  // under a country filter — otherwise they're "not mentioned" by the
  // cost-centre-only filter.
  const countryCodes = country ? equivalentCountryCodes(country) : [];
  const accountIdsInCountry = country
    ? ((
        await supabase
          .schema("accounting")
          .from("chart_of_accounts")
          .select("id, country")
          .eq("company_id", companyId)
          .in("country", countryCodes)
          .is("deleted_at", null)
      ).data ?? []).map((a) => a.id as string)
    : [];

  let linesQuery = supabase
    .schema("reporting")
    .from("v_ledger_entries")
    .select("account_id, account_code, account_name, account_type, debit_amount, credit_amount")
    .eq("company_id", companyId)
    .in("account_type", ["income", "expense"])
    .gte("entry_date", from)
    .lte("entry_date", to);
  if (country) {
    // Line belongs to the country if its cost centre is in that country (codes
    // normalised, AE/UAE together), or — with no cost centre — the account
    // itself is tagged to that country.
    linesQuery = accountIdsInCountry.length
      ? linesQuery.or(
          `cost_center_country.in.(${countryCodes.join(",")}),and(cost_center_country.is.null,account_id.in.(${accountIdsInCountry.join(",")}))`,
        )
      : linesQuery.in("cost_center_country", countryCodes);
  }
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
  // Blank out zero figures so the statement doesn't carry a wall of "SYMBOL 0".
  const moneyOrBlank = (n: number) => (Math.abs(n) < 0.005 ? "" : money(n));

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
    // Net each account first, then show it on ONE side by its balance, so an
    // account with both debits and credits shows its net rather than the gross
    // movements split across both columns.
    const netSigned = (a.debit - a.credit) * factor; // positive = net debit
    const debit = netSigned > 0 ? netSigned : 0;
    const credit = netSigned < 0 ? -netSigned : 0;
    if (a.account_type === "income") {
      const balance = -netSigned; // income is credit-normal
      if (balance !== 0)
        income.push({ account_code: a.account_code, account_name: a.account_name, debit, credit, balance });
    } else {
      const balance = netSigned;
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
    ...income.map((r, i) => ({ ...r, section: "Income", sno: i + 1 })),
    ...expense.map((r, i) => ({ ...r, section: "Expense", sno: i + 1 })),
  ];

  // ---- CoA hierarchy for the collapsible P&L tree ----
  const { data: coa } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_code, account_name, parent_id, is_group, account_type")
    .eq("company_id", companyId)
    .is("deleted_at", null);
  type CoaNode = {
    id: string;
    account_code: string;
    account_name: string;
    parent_id: string | null;
    is_group: boolean;
    account_type: string;
  };
  const coaAccounts = (coa ?? []) as CoaNode[];
  const childrenOf = new Map<string, CoaNode[]>();
  for (const a of coaAccounts) {
    const key = a.parent_id ?? "__root__";
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(a);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.account_code.localeCompare(b.account_code));

  // Net-bucketed per account (matches the section rows), so group Debit/Credit
  // columns roll up as net balances too.
  const balById = new Map<string, { debit: number; credit: number }>();
  for (const [id, a] of byAccount) {
    const netSigned = (a.debit - a.credit) * factor;
    balById.set(id, { debit: netSigned > 0 ? netSigned : 0, credit: netSigned < 0 ? -netSigned : 0 });
  }
  const nodeTotals = new Map<string, { debit: number; credit: number }>();
  function totalsFor(node: CoaNode): { debit: number; credit: number } {
    const cached = nodeTotals.get(node.id);
    if (cached) return cached;
    const t = { debit: 0, credit: 0 };
    if (node.is_group) {
      for (const c of childrenOf.get(node.id) ?? []) {
        const ct = totalsFor(c);
        t.debit += ct.debit;
        t.credit += ct.credit;
      }
    } else {
      const b = balById.get(node.id);
      if (b) {
        t.debit = b.debit;
        t.credit = b.credit;
      }
    }
    nodeTotals.set(node.id, t);
    return t;
  }
  const nonZero = (t: { debit: number; credit: number }) => Math.abs(t.debit) >= 0.005 || Math.abs(t.credit) >= 0.005;
  const amountOf = (t: { debit: number; credit: number }, type: "income" | "expense") =>
    type === "income" ? t.credit - t.debit : t.debit - t.credit;

  let plSeq = 0;
  function collectPl(node: CoaNode, depth: number, parentId: string | null, type: "income" | "expense"): PlRow[] {
    const t = totalsFor(node);
    if (node.is_group) {
      const children = (childrenOf.get(node.id) ?? []).flatMap((c) => collectPl(c, depth + 1, node.id, type));
      if (children.length === 0) return [];
      return [
        {
          id: node.id,
          parentId,
          depth,
          isGroup: true,
          seq: null,
          code: "",
          name: node.account_name ?? "",
          debit: moneyOrBlank(t.debit),
          credit: moneyOrBlank(t.credit),
          amount: moneyOrBlank(amountOf(t, type)),
        },
        ...children,
      ];
    }
    if (!nonZero(t)) return [];
    const seq = ++plSeq;
    return [
      {
        id: node.id,
        parentId,
        depth,
        isGroup: false,
        seq,
        code: formatAccountCode(node.account_code),
        name: node.account_name ?? "",
        debit: t.debit ? money(t.debit) : "",
        credit: t.credit ? money(t.credit) : "",
        amount: money(amountOf(t, type)),
      },
    ];
  }
  const incomeTree = (childrenOf.get("__root__") ?? [])
    .filter((n) => n.account_type === "income")
    .flatMap((r) => collectPl(r, 0, null, "income"));
  plSeq = 0;
  const expenseTree = (childrenOf.get("__root__") ?? [])
    .filter((n) => n.account_type === "expense")
    .flatMap((r) => collectPl(r, 0, null, "expense"));

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
              headers={["S.No", "Section", "Code", "Name", "Debit", "Credit", "Amount"]}
              rows={exportRows.map((r) => [r.sno, r.section, formatAccountCode(r.account_code), r.account_name, r.debit, r.credit, r.balance])}
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
      </div>

      <ProfitLossTree
        income={incomeTree}
        expense={expenseTree}
        incomeTotal={{ debit: money(sumDebit(income)), credit: money(sumCredit(income)), amount: money(totalIncome) }}
        expenseTotal={{ debit: money(sumDebit(expense)), credit: money(sumCredit(expense)), amount: money(totalExpense) }}
        netProfit={{ amount: money(netProfit), positive: netProfit >= 0 }}
      />
    </div>
  );
}
