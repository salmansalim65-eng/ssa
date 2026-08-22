import {
  ArrowLeftRightIcon,
  BanknoteIcon,
  ClockIcon,
  LandmarkIcon,
  PercentIcon,
  ReceiptIcon,
  ScaleIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { FinancialDashboardCharts } from "@/components/reports/financial-dashboard-charts";

function today() {
  return new Date().toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function FinancialDashboardPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const asOf = today();
  const year = asOf.slice(0, 4);
  const yearStart = `${year}-01-01`;

  const [{ data: lines }, { data: companyCurrencies }, { data: costCenters }, { data: rentRows }, { data: coaCountries }] =
    await Promise.all([
      supabase
        .schema("reporting")
        .from("v_ledger_entries")
        .select(
          "account_id, account_type, debit_amount, credit_amount, entry_date, cost_center_id, cost_center_country, is_cash, is_bank, is_tenant_account, is_fixed_asset_account",
        )
        .eq("company_id", companyId)
        .lte("entry_date", asOf),
      supabase
        .schema("core")
        .from("company_currencies")
        .select("is_base_currency, currencies:currency_id(symbol, code)")
        .eq("company_id", companyId)
        .eq("is_base_currency", true)
        .maybeSingle(),
      supabase
        .schema("accounting")
        .from("cost_centers")
        .select("id, name")
        .eq("company_id", companyId),
      supabase
        .schema("reporting")
        .from("v_rental_income")
        .select("net_amount, net_outstanding, exchange_rate")
        .eq("company_id", companyId),
      supabase
        .schema("accounting")
        .from("chart_of_accounts")
        .select("id, country")
        .eq("company_id", companyId),
    ]);

  const baseCurrency = (companyCurrencies as unknown as { currencies: { symbol: string; code: string } | null } | null)
    ?.currencies;
  const symbol = baseCurrency?.symbol ?? baseCurrency?.code ?? "";
  const money = (n: number) => `${symbol ? symbol + " " : ""}${formatMoney(n)}`;
  const ccName = new Map((costCenters ?? []).map((c) => [c.id as string, c.name as string]));

  const coaCountryById = new Map<string, string | null>(
    (coaCountries ?? []).map((a) => [a.id as string, (a.country as string | null) ?? null]),
  );
  const normCountry = (c: string | null | undefined): "AE" | "PK" | null => {
    const u = (c ?? "").trim().toUpperCase();
    if (u === "AE" || u === "UAE") return "AE";
    if (u === "PK" || u === "PAK" || u === "PAKISTAN") return "PK";
    return null;
  };
  const NON_BALANCE_TYPES = new Set(["equity", "income", "expense"]);

  let assets = 0;
  let liabilities = 0;
  let equity = 0;
  let income = 0;
  let expense = 0;
  let cashBank = 0;
  let cashFlowYtd = 0;
  const balByCountry: Record<"AE" | "PK", number> = { AE: 0, PK: 0 }; // net debit
  const monthlyIncome = new Map<string, number>();
  const monthlyExpense = new Map<string, number>();
  const expenseByCc = new Map<string, number>();

  for (const l of lines ?? []) {
    const net = Number(l.debit_amount) - Number(l.credit_amount); // net debit
    const type = l.account_type as string;
    const ym = String(l.entry_date ?? "").slice(0, 7);
    const inYear = String(l.entry_date ?? "") >= yearStart;
    if (type === "asset") assets += net;
    else if (type === "liability") liabilities += -net;
    else if (type === "equity") equity += -net;
    else if (type === "income") {
      if (inYear) {
        income += -net;
        if (ym) monthlyIncome.set(ym, (monthlyIncome.get(ym) ?? 0) + -net);
      }
    } else if (type === "expense") {
      if (inYear) {
        expense += net;
        if (ym) monthlyExpense.set(ym, (monthlyExpense.get(ym) ?? 0) + net);
        const key = (l.cost_center_id as string | null) ?? "__none__";
        expenseByCc.set(key, (expenseByCc.get(key) ?? 0) + net);
      }
    }
    if (l.is_cash || l.is_bank) {
      cashBank += net;
      if (inYear) cashFlowYtd += net;
    }
    // Operating balances by country (same exclusions as the main dashboard:
    // drop cash/bank, tenant and fixed-asset accounts and equity/income/expense).
    if (
      !NON_BALANCE_TYPES.has(type) &&
      !l.is_cash &&
      !l.is_bank &&
      !l.is_tenant_account &&
      !l.is_fixed_asset_account
    ) {
      const ctry = normCountry((l.cost_center_country as string | null) ?? coaCountryById.get(l.account_id as string));
      if (ctry) balByCountry[ctry] += net;
    }
  }

  const netProfit = income - expense;
  const rentBilled = (rentRows ?? []).reduce(
    (s, r) => s + Number(r.net_amount) * (Number(r.exchange_rate) || 1),
    0,
  );
  const outstandingRent = (rentRows ?? []).reduce(
    (s, r) => s + Number(r.net_outstanding) * (Number(r.exchange_rate) || 1),
    0,
  );
  const rentCollected = rentBilled - outstandingRent;
  const collectionRate = rentBilled > 0 ? Math.round((rentCollected / rentBilled) * 100) : 0;
  const drCr = (net: number) => `${money(Math.abs(net))} ${net >= 0 ? "Dr" : "Cr"}`;

  // Chart data (base currency).
  const position = [
    { key: "assets", label: "Assets", value: Math.max(0, assets), color: "#2f8f4e" },
    { key: "liabilities", label: "Liabilities", value: Math.max(0, liabilities), color: "#3A53A4" },
    { key: "equity", label: "Equity", value: Math.max(0, equity + netProfit), color: "#C79A3A" },
  ];
  const incomeExpense = [
    { key: "income", label: "Income", value: Math.max(0, income), color: "#2f8f4e" },
    { key: "expense", label: "Expenses", value: Math.max(0, expense), color: "#B5695A" },
  ];
  const monthKeys = [...new Set([...monthlyIncome.keys(), ...monthlyExpense.keys()])].sort();
  const monthlyNet = monthKeys.map((ym) => {
    const [y, m] = ym.split("-");
    return {
      label: `${MONTHS[Number(m) - 1]} ${y.slice(2)}`,
      value: (monthlyIncome.get(ym) ?? 0) - (monthlyExpense.get(ym) ?? 0),
    };
  });
  const expenseByCcData = [...expenseByCc.entries()]
    .map(([id, value]) => ({ key: id, label: id === "__none__" ? "Unassigned" : ccName.get(id) ?? "—", value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Financial Dashboard"
        description={`Financial position and performance as of ${asOf}. Amounts in ${baseCurrency?.code ?? "base currency"}.`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total assets" value={money(assets)} icon={LandmarkIcon} />
        <KpiCard label="Total liabilities" value={money(liabilities)} icon={ScaleIcon} />
        <KpiCard label="Equity" value={money(equity + netProfit)} icon={BanknoteIcon} />
        <KpiCard
          label={`Net profit (${year})`}
          value={money(netProfit)}
          icon={TrendingUpIcon}
          tone={netProfit >= 0 ? "success" : "destructive"}
        />
        <KpiCard label="Cash & bank" value={money(cashBank)} icon={WalletIcon} />
        <KpiCard
          label={`Net cash flow (${year})`}
          value={money(cashFlowYtd)}
          icon={ArrowLeftRightIcon}
          tone={cashFlowYtd >= 0 ? "success" : "destructive"}
        />

        <KpiCard label="Balances UAE" value={drCr(balByCountry.AE)} icon={LandmarkIcon} />
        <KpiCard label="Balances PK" value={drCr(balByCountry.PK)} icon={LandmarkIcon} />
        <KpiCard label="Rent billed" value={money(rentBilled)} icon={ReceiptIcon} />
        <KpiCard label="Rent collected" value={money(rentCollected)} icon={BanknoteIcon} tone="success" />
        <KpiCard
          label="Rent outstanding"
          value={money(outstandingRent)}
          icon={ClockIcon}
          tone={outstandingRent > 0 ? "warning" : undefined}
        />
        <KpiCard label="Collection rate" value={`${collectionRate}%`} icon={PercentIcon} />
      </div>

      <FinancialDashboardCharts
        symbol={symbol}
        position={position}
        incomeExpense={incomeExpense}
        monthlyNet={monthlyNet}
        expenseByCc={expenseByCcData}
      />
    </div>
  );
}
