import { Suspense } from "react";

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
import { BalanceSheetTree, type BsRow, type BsTotal } from "./balance-sheet-tree";

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
  // Blank out zero figures so the sheet doesn't carry a wall of "SYMBOL 0".
  const moneyOrBlank = (n: number) => (Math.abs(n) < 0.005 ? "" : money(n));
  // `SYMBOL 1,234 Dr` / `SYMBOL 1,234 Cr` from a net debit figure (blank at zero).
  const balanceLabel = (net: number) =>
    Math.abs(net) < 0.005 ? "" : `${money(Math.abs(net))} ${net >= 0 ? "Dr" : "Cr"}`;

  const byAccount = aggregateByAccount(lines ?? []);

  // ---- Chart-of-Accounts tree (for hierarchical grouping) ----
  // The balance sheet mirrors the CoA group hierarchy: each group nests its
  // sub-groups and accounts with a rolled-up subtotal, like Chart of Accounts
  // (EQUITY → CAPITAL → SS GROUP → …).
  const { data: coa } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_code, account_name, parent_id, is_group, account_type, is_active")
    .eq("company_id", companyId)
    .is("deleted_at", null);
  type CoaNode = {
    id: string;
    account_code: string;
    account_name: string;
    parent_id: string | null;
    is_group: boolean;
    account_type: string;
    is_active: boolean;
  };
  const coaAccounts = (coa ?? []) as CoaNode[];
  const childrenOf = new Map<string, CoaNode[]>();
  for (const a of coaAccounts) {
    const key = a.parent_id ?? "__root__";
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(a);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.account_code.localeCompare(b.account_code));

  // "Inactive": an account/group flagged inactive, or one under a group named
  // like "Inactive Accounts". Inactivity flows down to descendants. These are
  // pulled out of the main sections into their own Inactive Accounts block.
  const inactiveIds = new Set<string>();
  {
    const stack = coaAccounts.filter((n) => n.is_active === false || /in\s*active/i.test(n.account_name));
    for (const n of stack) inactiveIds.add(n.id);
    while (stack.length) {
      const n = stack.pop()!;
      for (const c of childrenOf.get(n.id) ?? []) {
        if (!inactiveIds.has(c.id)) {
          inactiveIds.add(c.id);
          stack.push(c);
        }
      }
    }
  }

  // Active balances by type drive the section totals + balance check (inactive
  // accounts are excluded here and reported in their own block below).
  const buckets: Record<AccountType, AccountBalance[]> = {
    asset: [],
    liability: [],
    equity: [],
    income: [],
    expense: [],
  };
  for (const [id, a] of byAccount) {
    if (inactiveIds.has(id)) continue;
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

  // Converted balance per account id (base ledger amounts × currency factor).
  const balById = new Map<string, { debit: number; credit: number }>();
  for (const [id, a] of byAccount) balById.set(id, { debit: a.debit * factor, credit: a.credit * factor });
  // Roll a group's balance up from its descendants (leaf accounts read balById).
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
  const nonZero = (t: { debit: number; credit: number }) =>
    Math.abs(t.debit) >= 0.005 || Math.abs(t.credit) >= 0.005;
  // Build a flat, serialisable descriptor list for the collapsible client tree.
  // Groups are subtotal bands; empty groups and zero-balance accounts are pruned
  // so the sheet stays a balance sheet, not a full account dump. Leaf accounts
  // get a serial number; group rows don't. Reset between the active statement
  // and the inactive block.
  let leafSeq = 0;
  function collectRows(node: CoaNode, depth: number, parentId: string | null, renderingInactive: boolean): BsRow[] {
    if (!renderingInactive && inactiveIds.has(node.id)) return [];
    const t = totalsFor(node);
    const net = t.debit - t.credit;
    if (node.is_group) {
      const children = (childrenOf.get(node.id) ?? []).flatMap((c) => collectRows(c, depth + 1, node.id, renderingInactive));
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
          balance: balanceLabel(net),
        },
        ...children,
      ];
    }
    if (!nonZero(t)) return [];
    const seq = ++leafSeq;
    return [
      {
        id: node.id,
        parentId,
        depth,
        isGroup: false,
        seq,
        code: formatAccountCode(node.account_code),
        name: node.account_name ?? "",
        debit: moneyOrBlank(t.debit),
        credit: moneyOrBlank(t.credit),
        balance: balanceLabel(net),
      },
    ];
  }
  // Balance-sheet roots: the top-level asset / liability / equity groups &
  // accounts, in account-code order (income & expense live in the P&L).
  const BS_TYPES = new Set(["asset", "liability", "equity"]);
  const bsRoots = (childrenOf.get("__root__") ?? []).filter((n) => BS_TYPES.has(n.account_type));
  const treeRows = bsRoots.flatMap((r) => collectRows(r, 0, null, false));
  // The profit/(loss) line continues the active-statement numbering; the
  // inactive block restarts at 1.
  const profitSeq = leafSeq + 1;
  leafSeq = 0;

  // Inactive accounts, shown in their own section: the top of each inactive
  // subtree (a node whose parent is not itself inactive).
  const inactiveRows = coaAccounts
    .filter((n) => inactiveIds.has(n.id) && !(n.parent_id && inactiveIds.has(n.parent_id)))
    .sort((a, b) => a.account_code.localeCompare(b.account_code))
    .flatMap((r) => collectRows(r, 0, null, true));

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

  // Pre-formatted totals + profit row for the client tree.
  const totalsForTree: BsTotal[] = [
    {
      label: "Total assets",
      debit: moneyOrBlank(sumDebit(buckets.asset)),
      credit: moneyOrBlank(sumCredit(buckets.asset)),
      balance: balanceLabel(assetNet),
    },
    {
      label: "Total liabilities + equity",
      debit: moneyOrBlank(sumDebit(buckets.liability) + sumDebit(buckets.equity) + profitRow.debit),
      credit: moneyOrBlank(sumCredit(buckets.liability) + sumCredit(buckets.equity) + profitRow.credit),
      balance: balanceLabel(liabilitiesAndEquityNet),
      emphatic: true,
    },
  ];
  const profitForTree = {
    seq: profitSeq,
    debit: moneyOrBlank(profitRow.debit),
    credit: moneyOrBlank(profitRow.credit),
    balance: balanceLabel(netOf(profitRow)),
  };

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
              headers={["S.No", "Section", "Code", "Name", "Debit", "Credit", "Balance"]}
              rows={exportRows.map((r, i) => {
                const net = netOf(r);
                return [
                  i + 1,
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

      <BalanceSheetTree
        rows={treeRows}
        profit={profitForTree}
        totals={totalsForTree}
        inactiveRows={inactiveRows}
      />

      {!balanced && (
        <p className="text-xs font-medium text-destructive print:hidden">
          Assets ({balanceLabel(assetNet)}) do not equal liabilities + equity ({balanceLabel(liabilitiesAndEquityNet)}).
        </p>
      )}
    </div>
  );
}
