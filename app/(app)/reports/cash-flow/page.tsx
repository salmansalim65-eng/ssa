import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { CsvExportButton } from "@/components/reports/csv-export-button";
import { ReportSelectFilter } from "@/components/reports/report-select-filter";
import { PrintButton } from "@/components/vouchers/print-button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { HH_AGENT_PCT, UAE_AGENT_PCT } from "@/lib/rental/lease-accounting";

const HORIZONS = [
  { value: "1", label: "1 month" },
  { value: "2", label: "2 months" },
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "12 months" },
];

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthKey = (d: string) => d.slice(0, 7);
const monthLabel = (key: string) => `${MONTH_ABBR[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** The month keys from today's month forward, `count` of them. */
function horizonMonths(from: string, count: number): string[] {
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

interface CurrencyBlock {
  code: string;
  symbol: string;
  opening: number;
  /** Money in hand that belongs to somebody else (deposits held, tax provisions). */
  reserved: { name: string; amount: number }[];
  rows: { label: string; kind: "in" | "out"; owed: number; byMonth: Map<string, number> }[];
}

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ months?: string; cur?: string }>;
}) {
  const { months: monthsParam = "", cur: curParam = "" } = await searchParams;
  const horizon = HORIZONS.some((h) => h.value === monthsParam) ? Number(monthsParam) : 2;

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const today = new Date().toISOString().slice(0, 10);
  const months = horizonMonths(today, horizon);
  const lastMonth = months[months.length - 1];
  // Everything falling due up to the end of the last month in view.
  const horizonEnd = `${lastMonth}-31`;

  const [
    { data: ledger },
    { data: invoices },
    { data: pdcIn },
    { data: pdcOut },
    { data: currencies },
    { data: uaeLeases },
    { data: pkLeases },
    { data: uaeInvoiced },
    { data: pkInvoiced },
    { data: rentalAssets },
  ] = await Promise.all([
      supabase
        .schema("reporting")
        .from("v_ledger_entries")
        .select("account_id, account_type, doc_debit_amount, doc_credit_amount, currency_code, is_cash, is_bank")
        .eq("company_id", companyId),
      supabase
        .schema("reporting")
        .from("v_rental_income")
        .select("due_date, net_outstanding, currency_code")
        .eq("company_id", companyId)
        .gt("net_outstanding", 0),
      supabase
        .schema("accounting")
        .from("pdc_receipt_voucher_lines")
        .select("due_date, amount, pdc_receipt_vouchers!inner(company_id, pdc_status, currency_id)")
        .eq("pdc_receipt_vouchers.company_id", companyId)
        .eq("pdc_receipt_vouchers.pdc_status", "pending")
        .lte("due_date", horizonEnd),
      supabase
        .schema("accounting")
        .from("pdc_payment_voucher_lines")
        .select("due_date, amount, pdc_payment_vouchers!inner(company_id, pdc_status, currency_id)")
        .eq("pdc_payment_vouchers.company_id", companyId)
        .eq("pdc_payment_vouchers.pdc_status", "pending")
        .lte("due_date", horizonEnd),
      supabase.schema("core").from("currencies").select("id, code, symbol"),
      // Leases still running, so rent NOT yet invoiced can be forecast from them.
      supabase
        .schema("rental")
        .from("uae_leases")
        .select("id, asset_id, rental_amount, lease_type, lease_start, lease_end")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null),
      supabase
        .schema("rental")
        .from("pk_leases")
        .select("id, asset_id, monthly_rent, lease_start, lease_end")
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null),
      supabase
        .schema("rental")
        .from("uae_rent_invoices")
        .select("lease_id, period_start, period_end")
        .eq("company_id", companyId),
      supabase
        .schema("rental")
        .from("pk_rent_invoices")
        .select("lease_id, due_date")
        .eq("company_id", companyId),
      // A rental property with no lease running is still expected to earn — its
      // own estimated rent is the best figure there is.
      supabase
        .schema("assets")
        .from("assets")
        .select("id, estimated_rent, country")
        .eq("company_id", companyId)
        .eq("is_rental", true)
        .is("deleted_at", null),
    ]);

  const currencyById = new Map(
    (currencies ?? []).map((c) => [c.id as string, { code: c.code as string, symbol: c.symbol as string }]),
  );
  const symbolByCode = new Map((currencies ?? []).map((c) => [c.code as string, c.symbol as string]));

  const { data: coa } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, account_name, account_type, parent_id, is_long_term")
    .eq("company_id", companyId)
    .is("deleted_at", null);
  const coaById = new Map(
    (coa ?? []).map((a) => [
      a.id as string,
      {
        name: a.account_name as string,
        type: a.account_type as string,
        parentId: (a.parent_id as string | null) ?? null,
        longTerm: Boolean(a.is_long_term),
      },
    ]),
  );
  const liabilityAccounts = (coa ?? []).filter((a) => a.account_type === "liability");
  const longTermIds = new Set(
    liabilityAccounts.filter((a) => a.is_long_term).map((a) => a.id as string),
  );

  // A party account — somebody who owes us. The chart marks its tenant group,
  // but customers sit under their own group with no flag, so the parent's name
  // decides, the same keywords the Chart of Accounts screen already uses to
  // decide an account is a party.
  const RECEIVABLE_PARENTS = ["TENANT", "CUSTOMER", "DEBTOR", "RECEIVABLE"];
  const isReceivableAccount = (accountId: string) => {
    const account = coaById.get(accountId);
    if (!account || account.type !== "asset") return false;
    const parent = account.parentId ? coaById.get(account.parentId) : undefined;
    const parentName = (parent?.name ?? "").toUpperCase();
    return RECEIVABLE_PARENTS.some((k) => parentName.includes(k));
  };

  // ---- What is in the bank today, and what of it is already spoken for ----
  const openingByCode = new Map<string, number>();
  const reservedByCode = new Map<string, Map<string, number>>();
  const liabilityNames = new Map<string, string>();
  // Money owed TO the company on a party account — A.SAMAD, a tenant carrying a
  // balance. It has no due date, so it is reported as owed rather than dropped
  // into a month it may not arrive in.
  const receivableByCode = new Map<string, Map<string, number>>();
  for (const l of ledger ?? []) {
    const code = (l.currency_code as string | null) ?? "";
    if (!code) continue;
    const net = Number(l.doc_debit_amount) - Number(l.doc_credit_amount);
    if (l.is_cash || l.is_bank) {
      openingByCode.set(code, (openingByCode.get(code) ?? 0) + net);
    } else if (isReceivableAccount(l.account_id as string)) {
      if (!receivableByCode.has(code)) receivableByCode.set(code, new Map());
      const per = receivableByCode.get(code)!;
      const id = l.account_id as string;
      per.set(id, (per.get(id) ?? 0) + net);
    } else if (l.account_type === "liability" && !longTermIds.has(l.account_id as string)) {
      // A credit balance on a liability is money owed out — a deposit held for a
      // tenant, tax collected and not yet paid. It is in the bank but not yours.
      // A LONG-TERM liability is skipped: it is not going anywhere soon, so
      // holding cash against it would understate the headroom.
      if (!reservedByCode.has(code)) reservedByCode.set(code, new Map());
      const per = reservedByCode.get(code)!;
      const id = l.account_id as string;
      per.set(id, (per.get(id) ?? 0) - net);
    }
  }
  for (const a of liabilityAccounts) liabilityNames.set(a.id as string, a.account_name as string);


  // ---- Dated movements ----
  const blocks = new Map<string, CurrencyBlock>();
  const blockFor = (code: string): CurrencyBlock => {
    let b = blocks.get(code);
    if (!b) {
      b = {
        code,
        symbol: symbolByCode.get(code) ?? code,
        opening: openingByCode.get(code) ?? 0,
        reserved: [...(reservedByCode.get(code) ?? new Map())]
          .filter(([, amount]) => Math.abs(amount) >= 0.005)
          .map(([id, amount]) => ({ name: liabilityNames.get(id) ?? "Liability", amount }))
          .sort((x, y) => y.amount - x.amount),
        rows: [],
      };
      blocks.set(code, b);
    }
    return b;
  };
  const rowFor = (code: string, label: string, kind: "in" | "out") => {
    const block = blockFor(code);
    let row = block.rows.find((r) => r.label === label);
    if (!row) {
      row = { label, kind, owed: 0, byMonth: new Map() };
      block.rows.push(row);
    }
    return row;
  };
  const add = (code: string, label: string, kind: "in" | "out", due: string, amount: number) => {
    if (!code || !due || !amount) return;
    const row = rowFor(code, label, kind);
    if (due < today) row.owed += amount;
    else {
      const key = monthKey(due);
      if (!months.includes(key)) return;
      row.byMonth.set(key, (row.byMonth.get(key) ?? 0) + amount);
    }
  };

  for (const i of invoices ?? []) {
    add(
      (i.currency_code as string) ?? "",
      "Rent invoiced, not yet received",
      "in",
      (i.due_date as string) ?? "",
      Number(i.net_outstanding),
    );
  }
  type PdcLine = { due_date: string | null; amount: number };
  for (const l of (pdcIn ?? []) as unknown as (PdcLine & { pdc_receipt_vouchers: { currency_id: string } })[]) {
    add(
      currencyById.get(l.pdc_receipt_vouchers?.currency_id)?.code ?? "",
      "Cheques in hand maturing",
      "in",
      l.due_date ?? "",
      Number(l.amount),
    );
  }
  for (const l of (pdcOut ?? []) as unknown as (PdcLine & { pdc_payment_vouchers: { currency_id: string } })[]) {
    add(
      currencyById.get(l.pdc_payment_vouchers?.currency_id)?.code ?? "",
      "Cheques issued maturing",
      "out",
      l.due_date ?? "",
      Number(l.amount),
    );
  }
  // One row per party who owes something, in the "owed" column.
  for (const [code, perAccount] of receivableByCode) {
    for (const [accountId, amount] of perAccount) {
      if (amount < 0.005) continue; // a credit balance is not a receivable
      rowFor(code, `Receivable — ${coaById.get(accountId)?.name ?? "party"}`, "in").owed += amount;
    }
  }

  // ---- Rent the leases will produce but nobody has invoiced yet ----
  // The rows above only know invoices that EXIST. A lease running to next April
  // will earn rent every month between now and then, and none of it is in the
  // forecast until somebody raises the invoice — which is precisely the money
  // this report is asked about. So each running lease is projected forward, and
  // any month it has already been invoiced for is skipped so the two rows never
  // count the same rent twice.
  //
  // The figure is the OWNER's net: the agent's share (5% on a UAE lease, 10% on
  // an HH one) comes off the top, exactly as invoicing does it. PK leases carry
  // no agent share.
  type UaeLease = {
    id: string;
    asset_id: string | null;
    rental_amount: number;
    lease_type: string | null;
    lease_start: string | null;
    lease_end: string | null;
  };
  type PkLease = {
    id: string;
    asset_id: string | null;
    monthly_rent: number;
    lease_start: string | null;
    lease_end: string | null;
  };

  const invoicedMonths = new Set<string>();
  for (const i of (uaeInvoiced ?? []) as unknown as {
    lease_id: string;
    period_start: string | null;
    period_end: string | null;
  }[]) {
    const from = i.period_start;
    const to = i.period_end ?? i.period_start;
    if (!from || !to) continue;
    // An invoice covering several months blocks every one of them.
    for (
      let d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
      d <= new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    ) {
      invoicedMonths.add(`${i.lease_id}:${d.toISOString().slice(0, 7)}`);
    }
  }
  for (const i of (pkInvoiced ?? []) as unknown as { lease_id: string; due_date: string | null }[]) {
    if (i.due_date) invoicedMonths.add(`${i.lease_id}:${monthKey(i.due_date)}`);
  }

  const projectRent = (
    leaseId: string,
    code: string,
    monthlyNet: number,
    start: string | null,
    end: string | null,
    label: string,
  ) => {
    if (!code || monthlyNet <= 0 || !start) return;
    for (const m of months) {
      if (invoicedMonths.has(`${leaseId}:${m}`)) continue;
      const monthStart = `${m}-01`;
      const lastDay = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
      const monthEnd = `${m}-${lastDay}`;
      // The lease has to actually be running in that month.
      if (start > monthEnd) continue;
      if (end && end < monthStart) continue;
      // Rent lands on the first of the month it covers; a month already begun
      // is taken as due today rather than in the past.
      const due = monthStart < today ? today : monthStart;
      add(code, label, "in", due, monthlyNet);
    }
  };

  const codeOf = (wanted: string) => ([...currencyById].find(([, c]) => c.code === wanted) ? wanted : "");
  for (const l of (uaeLeases ?? []) as unknown as UaeLease[]) {
    const pct = l.lease_type === "hh" ? HH_AGENT_PCT : UAE_AGENT_PCT;
    const net = Math.round(Number(l.rental_amount) * (1 - pct) * 100) / 100;
    projectRent(l.id, codeOf("AED"), net, l.lease_start, l.lease_end, "Rent expected, not yet invoiced");
  }
  for (const l of (pkLeases ?? []) as unknown as PkLease[]) {
    projectRent(
      l.id,
      codeOf("PKR"),
      Number(l.monthly_rent),
      l.lease_start,
      l.lease_end,
      "Rent expected, not yet invoiced",
    );
  }

  // ---- Months a property has no lease at all ----
  // A lease ending in September leaves the property earning nothing from October
  // in the rows above, which is only true if it is never let again. The
  // property's own estimated rent stands in for those months — at the same
  // owner's net, using the agent share of the last lease it carried. It is the
  // softest of the three rent rows and says so in its name.
  const leasedMonthsByAsset = new Map<string, Set<string>>();
  const agentPctByAsset = new Map<string, number>();
  const markLeased = (assetId: string | null, start: string | null, end: string | null) => {
    if (!assetId || !start) return;
    if (!leasedMonthsByAsset.has(assetId)) leasedMonthsByAsset.set(assetId, new Set());
    const set = leasedMonthsByAsset.get(assetId)!;
    for (const m of months) {
      const lastDay = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
      if (start > `${m}-${lastDay}`) continue;
      if (end && end < `${m}-01`) continue;
      set.add(m);
    }
  };
  for (const l of (uaeLeases ?? []) as unknown as UaeLease[]) {
    markLeased(l.asset_id, l.lease_start, l.lease_end);
    if (l.asset_id) agentPctByAsset.set(l.asset_id, l.lease_type === "hh" ? HH_AGENT_PCT : UAE_AGENT_PCT);
  }
  for (const l of (pkLeases ?? []) as unknown as PkLease[]) markLeased(l.asset_id, l.lease_start, l.lease_end);

  for (const a of (rentalAssets ?? []) as unknown as {
    id: string;
    estimated_rent: number | null;
    country: string | null;
  }[]) {
    const estimated = Number(a.estimated_rent ?? 0);
    if (estimated <= 0) continue;
    const country = (a.country ?? "").toUpperCase();
    const code = codeOf(country === "PK" ? "PKR" : country === "SA" ? "SAR" : "AED");
    // PK rent carries no agent share; the UAE share follows the last lease.
    const pct = country === "PK" ? 0 : agentPctByAsset.get(a.id) ?? UAE_AGENT_PCT;
    const net = Math.round(estimated * (1 - pct) * 100) / 100;
    const leased = leasedMonthsByAsset.get(a.id);
    for (const m of months) {
      if (leased?.has(m)) continue;
      const due = `${m}-01` < today ? today : `${m}-01`;
      add(code, "Rent expected if re-let, no lease running", "in", due, net);
    }
  }

  // A currency with cash but no dated movement still belongs in the report.
  for (const code of openingByCode.keys()) blockFor(code);

  const ordered = [...blocks.values()].sort((a, b) => b.opening - a.opening);

  // ---- The answer: what is safe to take out ----
  // The running balance has to hold in EVERY month, not just the last one, so
  // the headroom is the LOWEST point the balance reaches — and overdue money is
  // left out of it, because money that was due and has not arrived may not.
  const summary = ordered.map((block) => {
    const reservedTotal = block.reserved.reduce((s, r) => s + r.amount, 0);
    let running = block.opening;
    const closings = months.map((m) => {
      for (const row of block.rows) {
        const amount = row.byMonth.get(m) ?? 0;
        running += row.kind === "in" ? amount : -amount;
      }
      return running;
    });
    const lowest = closings.length ? Math.min(...closings) : block.opening;
    const owedIn = block.rows.reduce((s, r) => s + (r.kind === "in" ? r.owed : 0), 0);
    const owedOut = block.rows.reduce((s, r) => s + (r.kind === "out" ? r.owed : 0), 0);
    return {
      block,
      closings,
      lowest,
      reservedTotal,
      available: lowest - reservedTotal,
      owedIn,
      owedOut,
      // The optimistic reading: every receivable collected and every overdue
      // invoice honoured. Shown beside the cautious figure, never instead of it.
      availableIfCollected: lowest - reservedTotal + owedIn - owedOut,
    };
  });

  const money = (symbol: string, n: number) => `${symbol ? `${symbol} ` : ""}${formatMoney(n)}`;

  // ---- Everything at once, in one currency ----
  // Operationally the blocks above are the truth — a PKR balance cannot settle
  // an AED cheque. But an owner asking "what is the group worth to me" wants one
  // number, so the currencies are translated at today's rates into whichever one
  // is chosen. It is a view, not a claim that the money is interchangeable.
  const companyCurrencyCodes = [...new Set(ordered.map((b) => b.code))];
  const rateToBase = new Map<string, number>();
  await Promise.all(
    [...new Set([...companyCurrencyCodes, curParam].filter(Boolean))].map(async (code) => {
      const id = [...currencyById].find(([, c]) => c.code === code)?.[0];
      if (!id) return;
      const { data, error } = await supabase.schema("core").rpc("fn_exchange_rate_to_base", {
        p_company_id: companyId,
        p_currency_id: id,
        p_as_of_date: today,
      });
      if (!error && data) rateToBase.set(code, Number(data));
    }),
  );
  const targetCode = rateToBase.has(curParam) ? curParam : companyCurrencyCodes.includes("PKR") ? "PKR" : "";
  const targetRate = targetCode ? rateToBase.get(targetCode) ?? 0 : 0;
  const targetSymbol = targetCode ? symbolByCode.get(targetCode) ?? targetCode : "";
  // amount × (its rate to base) ÷ (the target's rate to base).
  const toTarget = (code: string, amount: number) => {
    const from = rateToBase.get(code);
    if (!from || !targetRate) return null;
    return (amount * from) / targetRate;
  };
  const combined =
    targetCode && summary.length > 1
      ? summary.reduce(
          (acc, r) => {
            const opening = toTarget(r.block.code, r.block.opening);
            const lowest = toTarget(r.block.code, r.lowest);
            const reserved = toTarget(r.block.code, r.reservedTotal);
            const available = toTarget(r.block.code, r.available);
            if (opening === null || lowest === null || reserved === null || available === null) {
              acc.partial = true;
              return acc;
            }
            acc.opening += opening;
            acc.lowest += lowest;
            acc.reserved += reserved;
            acc.available += available;
            return acc;
          },
          { opening: 0, lowest: 0, reserved: 0, available: 0, partial: false },
        )
      : null;
  const currencyOptions = companyCurrencyCodes
    .filter((c) => rateToBase.has(c))
    .map((c) => ({ value: c, label: c }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const csvRows = summary.flatMap(({ block, closings, reservedTotal, available }) => [
    [block.code, "Cash & bank today", "", block.opening, ...months.map(() => "")],
    ...block.rows.map((r) => [
      block.code,
      r.label,
      r.owed || "",
      "",
      ...months.map((m) => (r.kind === "in" ? 1 : -1) * (r.byMonth.get(m) ?? 0)),
    ]),
    [block.code, "Projected balance", "", "", ...closings],
    [block.code, "Held for others (deposits, tax)", "", reservedTotal, ...months.map(() => "")],
    [block.code, "Safe to withdraw", "", available, ...months.map(() => "")],
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Cash Flow Forecast"
        description={`What is in the bank today, what is due in and out over the next ${horizon} month${horizon === 1 ? "" : "s"}, and what is safe to take out.`}
        backHref="/dashboard"
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`cash-flow-forecast-${today}.csv`}
              headers={["Currency", "Line", "Already due", "Today", ...months.map(monthLabel)]}
              rows={csvRows}
            />
            <PrintButton />
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Suspense>
          <ReportSelectFilter
            label="Look ahead"
            param="months"
            allLabel="2 months"
            options={HORIZONS}
            selected={monthsParam}
            width="w-40"
          />
        </Suspense>
        {currencyOptions.length > 1 && (
          <Suspense>
            <ReportSelectFilter
              label="Show the total in"
              param="cur"
              allLabel={currencyOptions.some((c) => c.value === "PKR") ? "PKR" : currencyOptions[0].label}
              options={currencyOptions}
              selected={curParam}
              width="w-36"
            />
          </Suspense>
        )}
      </div>

      {/* Every country in one figure. */}
      {combined && (
        <div className="overflow-hidden rounded-xl border-2 border-primary bg-card shadow-sm">
          <div className="bg-primary px-3 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-primary-foreground">
            All countries together — safe to withdraw, in {targetCode}
          </div>
          <div className="grid gap-4 px-4 py-3 sm:grid-cols-4">
            <div>
              <p
                className={cn(
                  "font-mono text-2xl font-bold tabular-nums",
                  combined.available > 0 ? "text-foreground" : "text-destructive",
                )}
              >
                {money(targetSymbol, combined.available)}
              </p>
              <p className="text-xs text-muted-foreground">Safe to withdraw</p>
            </div>
            <div>
              <p className="font-mono text-lg tabular-nums text-foreground">
                {money(targetSymbol, combined.opening)}
              </p>
              <p className="text-xs text-muted-foreground">In the bank today</p>
            </div>
            <div>
              <p className="font-mono text-lg tabular-nums text-foreground">
                {money(targetSymbol, combined.lowest)}
              </p>
              <p className="text-xs text-muted-foreground">
                Lowest point in {horizon} month{horizon === 1 ? "" : "s"}
              </p>
            </div>
            <div>
              <p className="font-mono text-lg tabular-nums text-destructive">
                {combined.reserved ? `− ${money(targetSymbol, combined.reserved)}` : money(targetSymbol, 0)}
              </p>
              <p className="text-xs text-muted-foreground">Held for others</p>
            </div>
          </div>
          <p className="border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
            {combined.partial && (
              <span className="font-medium text-destructive">
                A currency with no exchange rate is missing from this total.{" "}
              </span>
            )}
            Translated at today&apos;s rates. The money is not interchangeable — settle each currency from its own
            balance below.
          </p>
        </div>
      )}

      {/* The headline, one card per currency — money is never converted here: a
          PKR balance cannot settle an AED cheque. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary.map(({ block, available, availableIfCollected, lowest, reservedTotal }) => (
          <div
            key={block.code}
            className="overflow-hidden rounded-xl border-2 border-ledger-dark bg-card shadow-sm"
          >
            <div className="bg-ledger-dark px-3 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-white">
              {block.code} — safe to withdraw
            </div>
            <div className="space-y-2 px-4 py-3">
              <p
                className={cn(
                  "font-mono text-2xl font-bold tabular-nums",
                  available > 0 ? "text-foreground" : "text-destructive",
                )}
              >
                {money(block.symbol, available)}
              </p>
              <dl className="space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between gap-3">
                  <dt>In the bank today</dt>
                  <dd className="font-mono tabular-nums">{money(block.symbol, block.opening)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Lowest point in the next {horizon} month{horizon === 1 ? "" : "s"}</dt>
                  <dd className="font-mono tabular-nums">{money(block.symbol, lowest)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Less held for others</dt>
                  <dd className="font-mono tabular-nums text-destructive">
                    {reservedTotal ? `− ${money(block.symbol, reservedTotal)}` : money(block.symbol, 0)}
                  </dd>
                </div>
                {availableIfCollected !== available && (
                  <div className="flex justify-between gap-3 border-t pt-1">
                    <dt>If everything owed is collected</dt>
                    <dd className="font-mono font-medium tabular-nums text-foreground">
                      {money(block.symbol, availableIfCollected)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        ))}
      </div>

      {summary.map(({ block, closings, reservedTotal, available, availableIfCollected, owedIn, owedOut }) => (
        <div key={block.code} className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {block.code}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-header text-header-foreground [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide">
                  <th className="text-left">Line</th>
                  <th className="text-right">Owed / already due</th>
                  {months.map((m) => (
                    <th key={m} className="whitespace-nowrap text-right">
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b bg-muted/20 [&>td]:px-3 [&>td]:py-2">
                  <td className="font-medium">Cash &amp; bank today</td>
                  <td />
                  <td className="text-right font-mono font-semibold tabular-nums" colSpan={months.length}>
                    {money(block.symbol, block.opening)}
                  </td>
                </tr>
                {block.rows.length === 0 && (
                  <tr className="border-b [&>td]:px-3 [&>td]:py-6">
                    <td colSpan={months.length + 2} className="text-center text-muted-foreground">
                      Nothing is due in or out in this window.
                    </td>
                  </tr>
                )}
                {block.rows.map((r) => (
                  <tr key={r.label} className="border-b [&>td]:px-3 [&>td]:py-2">
                    <td>
                      <span className={cn("mr-2 font-mono text-xs", r.kind === "in" ? "text-success" : "text-destructive")}>
                        {r.kind === "in" ? "+" : "−"}
                      </span>
                      {r.label}
                    </td>
                    <td className="text-right font-mono tabular-nums text-muted-foreground">
                      {r.owed ? money(block.symbol, r.owed) : "—"}
                    </td>
                    {months.map((m) => {
                      const amount = r.byMonth.get(m) ?? 0;
                      return (
                        <td key={m} className="text-right font-mono tabular-nums">
                          {amount ? money(block.symbol, amount) : <span className="text-muted-foreground">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-b bg-ledger/10 font-semibold [&>td]:px-3 [&>td]:py-2">
                  <td>Projected balance at month end</td>
                  <td />
                  {closings.map((c, i) => (
                    <td
                      key={months[i]}
                      className={cn("text-right font-mono tabular-nums", c < 0 && "text-destructive")}
                    >
                      {money(block.symbol, c)}
                    </td>
                  ))}
                </tr>
                {block.reserved.map((r) => (
                  <tr key={r.name} className="border-b [&>td]:px-3 [&>td]:py-2">
                    <td className="text-muted-foreground">
                      <span className="mr-2 font-mono text-xs text-destructive">−</span>
                      {r.name} <span className="text-xs">(held, not yours)</span>
                    </td>
                    <td className="text-right font-mono tabular-nums text-destructive">
                      {money(block.symbol, r.amount)}
                    </td>
                    <td colSpan={months.length} />
                  </tr>
                ))}
                <tr className="bg-header font-semibold text-header-foreground [&>td]:px-3 [&>td]:py-2.5">
                  <td>
                    Safe to withdraw — lowest projected balance less {money(block.symbol, reservedTotal)} held
                  </td>
                  <td />
                  <td className="text-right font-mono text-base tabular-nums" colSpan={months.length}>
                    {money(block.symbol, available)}
                  </td>
                </tr>
                {availableIfCollected !== available && (
                  <tr className="border-t [&>td]:px-3 [&>td]:py-2">
                    <td className="text-muted-foreground">…and if everything owed is collected</td>
                    <td className="text-right font-mono tabular-nums text-muted-foreground">
                      {money(block.symbol, owedIn - owedOut)}
                    </td>
                    <td className="text-right font-mono font-semibold tabular-nums" colSpan={months.length}>
                      {money(block.symbol, availableIfCollected)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {(owedIn > 0 || owedOut > 0) && (
            <p className="border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
              {owedIn > 0 && (
                <>
                  <span className="font-medium text-foreground">{money(block.symbol, owedIn)}</span> was already due
                  in and has not arrived
                  {owedOut > 0 ? ", " : ". "}
                </>
              )}
              {owedOut > 0 && (
                <>
                  <span className="font-medium text-foreground">{money(block.symbol, owedOut)}</span> was already due
                  out.{" "}
                </>
              )}
              Neither is counted above — money that was due and has not come may never come.
            </p>
          )}
        </div>
      ))}

      <div className="rounded-lg border bg-muted/20 px-4 py-3 text-xs text-muted-foreground print:hidden">
        <p className="mb-1 font-medium text-foreground">What this figure does and does not know</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>
            Money in comes in four kinds: rent <strong>already invoiced</strong> and unpaid; cheques in hand
            maturing; rent the running leases will earn but nobody has invoiced yet; and, for a month with no lease
            at all, the property&apos;s own estimated rent if it is re-let. The last two are at the owner&apos;s
            net, after the agent&apos;s share. A month is never counted by two of them.
          </li>
          <li>
            What parties owe — A.SAMAD, a tenant carrying a balance — has no due date, so it sits in the{" "}
            <strong>Owed</strong> column and in the second figure, never in a month.
          </li>
          <li>
            A lease is assumed to run to its end date and to be paid on time. It is a forecast, not a promise.
          </li>
          <li>
            Running costs — salaries, utilities, service charges, tax falling due — are <strong>not</strong>
            deducted. Subtract your own estimate before acting on this.
          </li>
          <li>Each currency stands alone. A PKR balance cannot settle an AED cheque.</li>
          <li>Balances are as of {formatDate(today)}, from posted entries only.</li>
        </ul>
      </div>
    </div>
  );
}
