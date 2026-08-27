import Link from "next/link";
import {
  AlertCircleIcon,
  Building2Icon,
  CalendarRangeIcon,
  WalletIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { SummaryCard, StatCol } from "@/components/dashboard/summary-card";
import { DashboardLiveRefresh } from "@/components/dashboard/live-refresh";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { formatAccountCode, formatDate, formatMoney, formatVoucherNo } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { isRentOverdue } from "@/lib/rental/overdue";
import { billingMonthStarts } from "@/lib/rental/billing-months";

// Always render fresh — the dashboard reflects live invoices, rent balances and
// ledger figures, so it must never be served from the route cache (otherwise a
// newly added or deleted invoice only shows after a manual refresh).
export const dynamic = "force-dynamic";

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Split a combined voucher's months into due instalments per payment terms. Each
// instalment falls due at the FIRST month of its block; `count` is how many
// months it covers. advance = one block (whole period); monthly = 1-month blocks;
// quarterly/half_yearly/yearly = 3/6/12-month blocks.
function rentDueChunks(months: string[], terms: string | null | undefined): { dueMonth: string; count: number }[] {
  const n = months.length;
  if (n === 0) return [];
  const size =
    terms === "advance"
      ? n
      : terms === "quarterly"
        ? 3
        : terms === "half_yearly"
          ? 6
          : terms === "yearly"
            ? 12
            : 1; // monthly (default)
  const step = Math.max(1, size);
  const chunks: { dueMonth: string; count: number }[] = [];
  for (let i = 0; i < n; i += step) chunks.push({ dueMonth: months[i], count: Math.min(step, n - i) });
  return chunks;
}

// Rent KPI tile that lists one amount per currency (AED and PKR kept separate),
// styled like KpiCard (green header over a light body).
function RentCurrencyCard({
  label,
  subtext,
  rows,
}: {
  label: string;
  subtext: string;
  rows: { code: string; amount: string }[];
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border-2 border-ledger-dark bg-card shadow-sm">
      <div className="truncate border-b-2 border-ledger-dark bg-ledger-dark px-3 py-1.5 text-center text-[0.7rem] font-bold uppercase tracking-wide text-white">
        {label}
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1.5 p-4">
        {rows.length ? (
          rows.map((r) => (
            <div key={r.code} className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{r.code}</span>
              <span className="font-mono text-lg font-semibold tabular-nums text-foreground">{r.amount}</span>
            </div>
          ))
        ) : (
          <span className="text-lg font-semibold text-muted-foreground">—</span>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p>
      </div>
    </div>
  );
}

// Each country card shows figures in that country's own currency.
const BALANCE_PANELS = {
  "balances-uae": { kind: "balances", ccCountry: "AE", rentCountry: "UAE", currency: "AED", label: "UAE" },
  "balances-pk": { kind: "balances", ccCountry: "PK", rentCountry: "PK", currency: "PKR", label: "Pakistan" },
  "rent-uae": { kind: "rent", ccCountry: "AE", rentCountry: "UAE", currency: "AED", label: "UAE" },
  "rent-pk": { kind: "rent", ccCountry: "PK", rentCountry: "PK", currency: "PKR", label: "Pakistan" },
} as const;
type PanelKey = keyof typeof BALANCE_PANELS;

// Country codes are inconsistent across the app (cost centres use "AE"/"PK";
// assets/rental use "UAE"/"PK"; a party account's own country can be either).
// Fold every spelling to the two canonical dashboard buckets so a balance lands
// under its country no matter which code was stored.
function normCountry(c: string | null | undefined): "AE" | "PK" | null {
  const u = (c ?? "").trim().toUpperCase();
  if (u === "AE" || u === "UAE") return "AE";
  if (u === "PK" || u === "PAK" || u === "PAKISTAN") return "PK";
  return null;
}

const money = (symbol: string, n: number) => (symbol ? `${symbol} ${formatMoney(n)}` : formatMoney(n));

// The "Balances" cards read as operating balances, so they exclude Cash & Bank,
// Fixed Asset and Tenant accounts, and also Equity, Revenue (income) and Expense
// account types — leaving asset/liability postings. Flags and account_type come
// from reporting.v_ledger_entries.
const NON_BALANCE_TYPES = new Set(["equity", "income", "expense"]);
function isExcludedFromBalances(r: {
  account_type?: string | null;
  is_cash?: boolean | null;
  is_bank?: boolean | null;
  is_tenant_account?: boolean | null;
  is_fixed_asset_account?: boolean | null;
}) {
  if (r.account_type && NON_BALANCE_TYPES.has(r.account_type)) return true;
  return Boolean(r.is_cash || r.is_bank || r.is_tenant_account || r.is_fixed_asset_account);
}

// Ledger accounts that are fixed assets, so the "Balances" cards can leave them
// out. Catches an account linked to a registered asset (linked_asset_id) AND any
// account sitting under a "Fixed Asset(s)" group in the chart-of-accounts tree —
// which covers fixed-asset accounts (e.g. a Van) that were created by hand and
// never linked to an asset record.
function computeFixedAssetAccountIds(
  rows: { id: string; parent_id?: string | null; account_name?: string | null; linked_asset_id?: string | null }[],
): Set<string> {
  const byId = new Map(rows.map((a) => [a.id, a]));
  const isFixedName = (n?: string | null) => /fixed[\s_-]*assets?/i.test(n ?? "");
  const underFixed = (id: string) => {
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 64) {
      if (isFixedName(cur.account_name)) return true;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return false;
  };
  return new Set(rows.filter((a) => a.linked_asset_id || underFixed(a.id)).map((a) => a.id));
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string; from?: string; to?: string }>;
}) {
  const { panel = "", from = "", to = "" } = await searchParams;
  const dateFrom = from || null;
  const dateTo = to || null;
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  // Party accounts carry their own country (chart_of_accounts.country). Used to
  // attribute ledger lines with no cost centre to a country bucket — read from
  // the base table so this never depends on a view column being present.
  const { data: coaCountries } = await supabase
    .schema("accounting")
    .from("chart_of_accounts")
    .select("id, country, parent_id, account_name, linked_asset_id")
    .eq("company_id", companyId);
  const coaCountryById = new Map<string, string | null>(
    (coaCountries ?? []).map((a) => [a.id as string, (a.country as string | null) ?? null]),
  );
  const fixedAssetAccountIds = computeFixedAssetAccountIds(coaCountries ?? []);
  const countryAccountIds = (coaCountries ?? [])
    .filter((a) => normCountry(a.country as string | null))
    .map((a) => a.id as string);

  const [
    { data: ledgerRows },
    { data: rentRows },
    { data: cashBankAccounts },
    { data: cashBankLedger },
    { count: pendingApprovals },
    { data: currencies },
    { count: rentalPropertyCount },
    { data: expenseLedger },
    { data: baseCurrencyRow },
  ] = await Promise.all([
    supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select(
        "account_id, cost_center_country, account_type, doc_debit_amount, doc_credit_amount, is_cash, is_bank, is_tenant_account, is_fixed_asset_account",
      )
      .eq("company_id", companyId)
      .or(
        `cost_center_country.in.(AE,UAE,PK)${
          countryAccountIds.length ? `,account_id.in.(${countryAccountIds.join(",")})` : ""
        }`,
      ),
    supabase
      .schema("reporting")
      .from("v_rental_income")
      .select("invoice_id, country, amount, outstanding_balance, net_amount, net_outstanding, due_date, exchange_rate, currency_code")
      .eq("company_id", companyId)
      .in("country", ["UAE", "PK"]),
    supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, account_code, account_name, currency_id, is_cash, is_bank")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .or("is_cash.eq.true,is_bank.eq.true")
      .order("account_code"),
    supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select("account_id, doc_debit_amount, doc_credit_amount, is_cash, is_bank")
      .eq("company_id", companyId)
      .or("is_cash.eq.true,is_bank.eq.true"),
    supabase
      .schema("accounting")
      .from("voucher_approvals")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "pending"),
    supabase.schema("core").from("currencies").select("id, code, symbol"),
    supabase
      .schema("assets")
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("is_rental", true)
      .is("deleted_at", null),
    supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select("debit_amount, credit_amount")
      .eq("company_id", companyId)
      .eq("account_type", "expense")
      .gte("entry_date", `${new Date().getFullYear()}-01-01`)
      .lte("entry_date", `${new Date().getFullYear()}-12-31`),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("currencies:currency_id(symbol, code)")
      .eq("company_id", companyId)
      .eq("is_base_currency", true)
      .maybeSingle(),
  ]);

  // Total expenses (base currency) for the current calendar year — dashboard KPI.
  const expenseTotal = (expenseLedger ?? []).reduce(
    (s, r) => s + Number(r.debit_amount) - Number(r.credit_amount),
    0,
  );
  const baseCurrency = (baseCurrencyRow as unknown as { currencies: { symbol: string; code: string } | null } | null)
    ?.currencies;
  const baseSymbol = baseCurrency?.symbol ?? baseCurrency?.code ?? "";

  const symbolByCode = new Map((currencies ?? []).map((c) => [c.code as string, c.symbol as string]));
  const symbolById = new Map((currencies ?? []).map((c) => [c.id as string, c.symbol as string]));
  const sym = (code: string) => symbolByCode.get(code) ?? code;
  const symById = (id: string | null) => (id ? symbolById.get(id) ?? "" : "");

  // Cash & Bank accounts, each with its posted balance in its own currency.
  const bankBalById = new Map<string, number>();
  for (const r of cashBankLedger ?? []) {
    const k = r.account_id as string;
    bankBalById.set(k, (bankBalById.get(k) ?? 0) + Number(r.doc_debit_amount) - Number(r.doc_credit_amount));
  }
  const bankAccounts = (cashBankAccounts ?? []).map((a) => ({
    id: a.id as string,
    code: a.account_code as string,
    name: a.account_name as string,
    symbol: symById(a.currency_id as string | null),
    balance: bankBalById.get(a.id as string) ?? 0,
    isBank: Boolean(a.is_bank),
  }));
  // Split cash and bank so each has its own dashboard card.
  const bankOnly = bankAccounts.filter((a) => a.isBank);
  const cashOnly = bankAccounts.filter((a) => !a.isBank);

  // Ledger balances in each country's own currency (document amounts). The
  // balance cards reflect operating balances only, so Cash & Bank, Fixed Asset
  // and Tenant accounts are excluded from the totals (and the drill-down below).
  const balByCountry: Record<string, { debit: number; credit: number }> = {
    AE: { debit: 0, credit: 0 },
    PK: { debit: 0, credit: 0 },
  };
  for (const r of ledgerRows ?? []) {
    // Attribute by cost centre, falling back to the account's own country so a
    // party account (e.g. a supplier opening balance) booked without a cost
    // centre still lands under its country. Codes are normalised (AE/UAE → AE).
    const country = normCountry(
      (r.cost_center_country as string | null) ?? coaCountryById.get(r.account_id as string),
    );
    const b = country ? balByCountry[country] : undefined;
    if (!b) continue;
    if (isExcludedFromBalances(r) || fixedAssetAccountIds.has(r.account_id as string)) continue;
    b.debit += Number(r.doc_debit_amount);
    b.credit += Number(r.doc_credit_amount);
  }

  // Rent figures in each country's own currency (document amounts), NET of the
  // agent/commission share — the owner's rent, not the gross billed to the
  // tenant. (v_rental_income.net_amount = amount − agent_share; net_outstanding
  // is that net reduced pro-rata as the tenant pays.)
  const rentByCountry: Record<
    string,
    { billed: number; outstanding: number; overdue: number; due: number; upcoming: number }
  > = {
    UAE: { billed: 0, outstanding: 0, overdue: 0, due: 0, upcoming: 0 },
    PK: { billed: 0, outstanding: 0, overdue: 0, due: 0, upcoming: 0 },
  };
  const now = today();

  // A combined UAE voucher is one invoice for a multi-month period with a single
  // (period-end) due date. Left whole it would sit entirely in "upcoming", so the
  // card's Due never reflects the current month. Expand each combined invoice into
  // monthly slices (like the Rent Balance detail) so each month buckets correctly.
  const round2card = (n: number) => Math.round(n * 100) / 100;
  const uaeRentInvoiceIds = [
    ...new Set(
      (rentRows ?? [])
        .filter((r) => r.country === "UAE" && r.invoice_id)
        .map((r) => r.invoice_id as string),
    ),
  ];
  const { data: cardInvMeta } = uaeRentInvoiceIds.length
    ? await supabase
        .schema("rental")
        .from("uae_rent_invoices")
        .select("id, lease_id, schedule_id")
        .in("id", uaeRentInvoiceIds)
    : { data: [] };
  type CardMeta = { id: string; lease_id: string; schedule_id: string | null };
  const cardMetaById = new Map(((cardInvMeta as CardMeta[]) ?? []).map((m) => [m.id, m]));

  // Resolve each combined invoice to its voucher's properties (leases), with each
  // property's own rent, period, type and payment terms — so the card buckets
  // every property's due by ITS terms (one voucher can mix Advance and Monthly).
  const cardFirstLeaseIds = [...new Set(((cardInvMeta as CardMeta[]) ?? []).map((m) => m.lease_id).filter(Boolean))];
  const { data: cardFirstLeases } = cardFirstLeaseIds.length
    ? await supabase.schema("rental").from("uae_leases").select("id, document_no").in("id", cardFirstLeaseIds)
    : { data: [] };
  const cardDocByFirstLease = new Map(
    ((cardFirstLeases as { id: string; document_no: string | null }[]) ?? []).map((l) => [l.id, l.document_no]),
  );
  const cardDocNos = [...new Set([...cardDocByFirstLease.values()].filter((d): d is string => Boolean(d)))];
  type CardLease = {
    id: string;
    document_no: string | null;
    asset_id: string | null;
    rental_amount: number;
    lease_start: string;
    lease_end: string;
    lease_type: string | null;
  };
  const { data: cardVoucherLeases } = cardDocNos.length
    ? await supabase
        .schema("rental")
        .from("uae_leases")
        .select("id, document_no, asset_id, rental_amount, lease_start, lease_end, lease_type")
        .in("document_no", cardDocNos)
        .is("deleted_at", null)
        .order("created_at")
    : { data: [] };
  // Keep one lease per property per voucher (newest) so a stray duplicate never
  // double-counts.
  const cardLeasesByDoc = new Map<string, Map<string, CardLease>>();
  for (const l of (cardVoucherLeases as CardLease[]) ?? []) {
    const doc = l.document_no as string;
    const byAsset = cardLeasesByDoc.get(doc) ?? new Map<string, CardLease>();
    if (l.asset_id) byAsset.set(l.asset_id, l);
    cardLeasesByDoc.set(doc, byAsset);
  }
  const cardLeaseIds = ((cardVoucherLeases as CardLease[]) ?? []).map((l) => l.id);
  const { data: cardTermRows } = cardLeaseIds.length
    ? await supabase.schema("rental").from("uae_leases").select("id, payment_terms").in("id", cardLeaseIds)
    : { data: [] };
  const cardTermsByLease = new Map(
    ((cardTermRows as { id: string; payment_terms: string | null }[]) ?? []).map((t) => [t.id, t.payment_terms]),
  );
  const { data: cardExpRows } = cardLeaseIds.length
    ? await supabase.schema("rental").from("lease_expenses").select("lease_id, amount").in("lease_id", cardLeaseIds)
    : { data: [] };
  const cardExpByLease = new Map<string, number>();
  for (const e of (cardExpRows as { lease_id: string; amount: number }[]) ?? []) {
    cardExpByLease.set(e.lease_id, (cardExpByLease.get(e.lease_id) ?? 0) + Number(e.amount));
  }

  for (const r of rentRows ?? []) {
    const g = rentByCountry[r.country as string];
    if (!g) continue;
    const netAmount = Number(r.net_amount);
    const netOutstanding = Number(r.net_outstanding);
    g.billed += netAmount;
    g.outstanding += netOutstanding;

    // Slices carry the due date the bucketing keys off. A combined voucher is
    // expanded per property × per instalment (each by its own terms); everything
    // else is a single slice on the invoice's own due date.
    const meta = r.country === "UAE" && r.invoice_id ? cardMetaById.get(r.invoice_id as string) : null;
    const doc = meta && !meta.schedule_id ? cardDocByFirstLease.get(meta.lease_id) : null;
    const vLeases = doc ? [...(cardLeasesByDoc.get(doc)?.values() ?? [])] : [];
    type Slice = { dueDate: string; out: number };
    let slices: Slice[];
    if (meta && !meta.schedule_id && vLeases.length) {
      // Preserve the invoice's paid proportion across the split slices.
      const paidRatio = netAmount > 0 ? netOutstanding / netAmount : 1;
      slices = [];
      for (const lease of vLeases) {
        const months = billingMonthStarts(lease.lease_start, lease.lease_end);
        const nn = months.length || 1;
        const isHh = lease.lease_type === "hh";
        const mRent = Number(lease.rental_amount) || 0;
        const mShare = round2card(mRent * (isHh ? 0.1 : 0.05));
        const fExp = cardExpByLease.get(lease.id) ?? 0;
        const terms = cardTermsByLease.get(lease.id) ?? "monthly";
        for (const ch of rentDueChunks(months, terms)) {
          const net = round2card(mRent * ch.count - mShare * ch.count - (fExp * ch.count) / nn);
          slices.push({ dueDate: ch.dueMonth, out: round2card(net * paidRatio) });
        }
      }
    } else {
      // Schedule-based invoice, or a combined one with no resolvable leases:
      // bucket the whole outstanding on the invoice's own due date.
      slices = [{ dueDate: String(r.due_date ?? "").slice(0, 10), out: netOutstanding }];
    }

    // Bucket each slice by due MONTH: overdue once the due month has fully passed;
    // "Due" during its due month; a due month not yet started is upcoming (still
    // part of the outstanding balance, but not yet due).
    for (const s of slices) {
      if (isRentOverdue(s.dueDate, now)) g.overdue += s.out;
      else if (s.dueDate && s.dueDate.slice(0, 7) <= now.slice(0, 7)) g.due += s.out;
      else g.upcoming += s.out;
    }
  }
  const rentReceipts = (c: string) => rentByCountry[c].billed - rentByCountry[c].outstanding;

  // ---- Analytics KPIs — rent kept in its own document currency, one line per
  // currency (AED and PKR shown separately, never converted to base). ----
  const rentByCode = new Map<string, { billed: number; outstanding: number }>();
  for (const r of rentRows ?? []) {
    const code = (r.currency_code as string) || baseCurrency?.code || "—";
    const e = rentByCode.get(code) ?? { billed: 0, outstanding: 0 };
    e.billed += Number(r.net_amount);
    e.outstanding += Number(r.net_outstanding);
    rentByCode.set(code, e);
  }
  const rentCurrencyRows = [...rentByCode.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, v]) => ({
      symbol: symbolByCode.get(code) ?? code,
      billed: v.billed,
      collected: v.billed - v.outstanding,
      outstanding: v.outstanding,
    }));

  const isBank = panel === "bank";
  const isCash = panel === "cash";
  const selected = (panel in BALANCE_PANELS ? panel : "") as PanelKey | "";
  // Rent Balance drill-downs default to the CURRENT MONTH when no range is set,
  // so the panel opens on this month's rent rather than the whole history.
  const isRentPanel = selected === "rent-uae" || selected === "rent-pk";
  const monthStart = `${now.slice(0, 7)}-01`;
  const monthLastDay = new Date(Number(now.slice(0, 4)), Number(now.slice(5, 7)), 0).getDate();
  const monthEnd = `${now.slice(0, 7)}-${String(monthLastDay).padStart(2, "0")}`;
  const rangeFrom = isRentPanel ? dateFrom ?? monthStart : dateFrom;
  const rangeTo = isRentPanel ? dateTo ?? monthEnd : dateTo;
  const detail = selected
    ? await loadDetail(companyId, selected, sym(BALANCE_PANELS[selected].currency), rangeFrom, rangeTo)
    : isBank
      ? bankDetail(bankOnly, "Bank Balances")
      : isCash
        ? bankDetail(cashOnly, "Cash Balances")
        : null;
  // The rent-balance detail panels support a date range.
  const detailPanelKey = selected;
  const showDateRange = detail !== null && detailPanelKey !== "";

  function cardHref(key: PanelKey | "bank" | "cash") {
    return panel === key ? "/dashboard" : `/dashboard?panel=${key}`;
  }

  const aed = sym("AED");
  const pkr = sym("PKR");
  const drCr = (symbol: string, net: number) => `${money(symbol, Math.abs(net))} ${net >= 0 ? "Dr" : "Cr"}`;

  return (
    <div className="space-y-6">
      <DashboardLiveRefresh />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Balances UAE"
          href={cardHref("balances-uae")}
          active={selected === "balances-uae"}
          footer={
            <div className="text-center text-base font-bold tabular-nums">
              {drCr(aed, balByCountry.AE.debit - balByCountry.AE.credit)}
            </div>
          }
        >
          <div className="flex justify-between gap-2">
            <StatCol value={money("", balByCountry.AE.debit)} label="Debit" />
            <StatCol value={money("", balByCountry.AE.credit)} label="Credit" align="right" />
          </div>
        </SummaryCard>

        <SummaryCard
          title="Balances PK"
          href={cardHref("balances-pk")}
          active={selected === "balances-pk"}
          footer={
            <div className="text-center text-base font-bold tabular-nums">
              {drCr(pkr, balByCountry.PK.debit - balByCountry.PK.credit)}
            </div>
          }
        >
          <div className="flex justify-between gap-2">
            <StatCol value={money("", balByCountry.PK.debit)} label="Debit" />
            <StatCol value={money("", balByCountry.PK.credit)} label="Credit" align="right" />
          </div>
        </SummaryCard>

        <SummaryCard
          title="Rent Balance UAE"
          href={cardHref("rent-uae")}
          active={selected === "rent-uae"}
          footer={
            <div className="flex items-center justify-between">
              <StatCol value={money(aed, rentReceipts("UAE"))} label="Receipts" />
              <div className="text-right text-sm font-bold tabular-nums">
                Balance: {money(aed, rentByCountry.UAE.outstanding)}
              </div>
            </div>
          }
        >
          <div className="grid grid-cols-3 gap-2">
            <StatCol value={money("", rentByCountry.UAE.overdue)} label="Overdue" />
            <StatCol value={money("", rentByCountry.UAE.due)} label="Due" align="center" />
            <StatCol value={money("", rentByCountry.UAE.overdue + rentByCountry.UAE.due)} label="Total" align="right" />
          </div>
        </SummaryCard>

        <SummaryCard
          title="Rent Balance PK"
          href={cardHref("rent-pk")}
          active={selected === "rent-pk"}
          footer={
            <div className="flex items-center justify-between">
              <StatCol value={money(pkr, rentReceipts("PK"))} label="Receipts" />
              <div className="text-right text-sm font-bold tabular-nums">
                Balance: {money(pkr, rentByCountry.PK.outstanding)}
              </div>
            </div>
          }
        >
          <div className="grid grid-cols-3 gap-2">
            <StatCol value={money("", rentByCountry.PK.overdue)} label="Overdue" />
            <StatCol value={money("", rentByCountry.PK.due)} label="Due" align="center" />
            <StatCol value={money("", rentByCountry.PK.overdue + rentByCountry.PK.due)} label="Total" align="right" />
          </div>
        </SummaryCard>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <SummaryCard
          title="Bank"
          href={cardHref("bank")}
          active={isBank}
          footer={
            <div className="text-center text-xs font-medium text-muted-foreground">
              {bankOnly.length} bank account{bankOnly.length === 1 ? "" : "s"} — click for detail
            </div>
          }
        >
          {bankOnly.length > 0 ? (
            <div className="space-y-1 text-sm">
              {bankOnly.map((a) => (
                <div key={a.code} className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-muted-foreground">{a.name}</span>
                  <span className="shrink-0 font-mono font-medium tabular-nums">{money(a.symbol, a.balance)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-1 text-sm text-muted-foreground">No bank accounts yet.</div>
          )}
        </SummaryCard>

        <SummaryCard
          title="Cash"
          href={cardHref("cash")}
          active={isCash}
          footer={
            <div className="text-center text-xs font-medium text-muted-foreground">
              {cashOnly.length} cash account{cashOnly.length === 1 ? "" : "s"} — click for detail
            </div>
          }
        >
          {cashOnly.length > 0 ? (
            <div className="space-y-1 text-sm">
              {cashOnly.map((a) => (
                <div key={a.code} className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-muted-foreground">{a.name}</span>
                  <span className="shrink-0 font-mono font-medium tabular-nums">{money(a.symbol, a.balance)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-1 text-sm text-muted-foreground">No cash accounts yet.</div>
          )}
        </SummaryCard>

        <SummaryCard
          title="Rental Reports"
          footer={
            <div className="text-center text-xs font-medium text-muted-foreground">
              Property &amp; rent analysis
            </div>
          }
        >
          <div className="space-y-1">
            <Link
              href="/reports/property-report"
              className="flex items-center justify-between gap-2 rounded px-1 py-1 transition-colors hover:bg-muted/60"
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Building2Icon className="size-4 text-ledger-dark" /> Rental Property Report
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {(rentalPropertyCount ?? 0).toLocaleString()}
              </span>
            </Link>
            <Link
              href="/reports/rent-report"
              className="flex items-center justify-between gap-2 rounded px-1 py-1 transition-colors hover:bg-muted/60"
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <CalendarRangeIcon className="size-4 text-ledger-dark" /> Rent Report
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">monthly</span>
            </Link>
          </div>
        </SummaryCard>

        <KpiCard
          label={`Expenses (${new Date().getFullYear()})`}
          value={`${baseSymbol ? baseSymbol + " " : ""}${formatMoney(expenseTotal)}`}
          subtext="Cost centre · account · month"
          icon={WalletIcon}
          href="/reports/expense-report"
        />

        <KpiCard
          label="Pending approvals"
          value={(pendingApprovals ?? 0).toLocaleString()}
          subtext="Awaiting a decision"
          icon={AlertCircleIcon}
          tone={(pendingApprovals ?? 0) > 0 ? "warning" : undefined}
          href="/accounting/voucher-register"
        />

      </div>

      {/* Analytics — KPIs and charts below the report cards. */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Analytics</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <RentCurrencyCard
            label="Rent billed"
            subtext="Owner's net rent"
            rows={rentCurrencyRows.map((r) => ({ code: r.symbol, amount: formatMoney(r.billed) }))}
          />
          <RentCurrencyCard
            label="Collected"
            subtext="Received to date"
            rows={rentCurrencyRows.map((r) => ({ code: r.symbol, amount: formatMoney(r.collected) }))}
          />
          <RentCurrencyCard
            label="Outstanding"
            subtext="Still uncollected"
            rows={rentCurrencyRows.map((r) => ({ code: r.symbol, amount: formatMoney(r.outstanding) }))}
          />
        </div>
      </div>

      {/* The selected tab's detail/report renders here — below ALL the cards. */}
      {detail && (
        <Card className="border-ledger-dark/40">
          <CardHeader className="border-b pb-4">
            <CardTitle>{detail.title}</CardTitle>
            <CardAction className="flex flex-wrap items-end gap-2">
              {showDateRange && (
                <form method="get" action="/dashboard" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="panel" value={detailPanelKey} />
                  <label className="flex flex-col text-[0.7rem] font-medium text-muted-foreground">
                    From
                    <input
                      type="date"
                      name="from"
                      defaultValue={rangeFrom ?? ""}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                    />
                  </label>
                  <label className="flex flex-col text-[0.7rem] font-medium text-muted-foreground">
                    To
                    <input
                      type="date"
                      name="to"
                      defaultValue={rangeTo ?? ""}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                    />
                  </label>
                  <Button type="submit" variant="outline" size="sm">
                    Apply
                  </Button>
                  {(dateFrom || dateTo) && (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/dashboard?panel=${detailPanelKey}`}>Clear</Link>
                    </Button>
                  )}
                </form>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard">Close</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">{detail.body}</CardContent>
        </Card>
      )}
    </div>
  );
}

// Cash / Bank drill-down — each account and its balance, shown in that
// account's own currency with its symbol.
function bankDetail(
  accounts: { id: string; code: string; name: string; symbol: string; balance: number }[],
  title: string,
) {
  return {
    title,
    body: (
      <Table className="[&_td]:first:pl-5 [&_td]:last:pr-5 [&_th]:first:pl-5 [&_th]:last:pr-5">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Account</TableHead>
            <TableHead>Currency</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((a) => (
            <TableRow key={a.code}>
              <TableCell>
                <Link
                  href={`/reports/general-ledger?accountIds=${a.id}`}
                  className="hover:underline"
                  title="Open ledger"
                >
                  <span className="font-mono text-xs text-muted-foreground">{formatAccountCode(a.code)}</span>{" "}
                  <span className="text-primary">{a.name}</span>
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{a.symbol || "—"}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(a.symbol, a.balance)}</TableCell>
            </TableRow>
          ))}
          {accounts.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                No cash or bank accounts yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    ),
  };
}

// Detail report for a selected card — figures in the country's own currency.
async function loadDetail(
  companyId: string,
  key: PanelKey,
  symbol: string,
  dateFrom: string | null,
  dateTo: string | null,
) {
  const supabase = await createClient();
  const cfg = BALANCE_PANELS[key];
  const fmt = (n: number) => money(symbol, n);

  if (cfg.kind === "balances") {
    // Party account → own country, read from the base table (no view-column dep).
    const { data: coaCountries } = await supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, country, parent_id, account_name, linked_asset_id")
      .eq("company_id", companyId);
    const coaCountryById = new Map<string, string | null>(
      (coaCountries ?? []).map((a) => [a.id as string, (a.country as string | null) ?? null]),
    );
    const fixedAssetAccountIds = computeFixedAssetAccountIds(coaCountries ?? []);
    const countryAccountIds = (coaCountries ?? [])
      .filter((a) => normCountry(a.country as string | null))
      .map((a) => a.id as string);

    const { data } = await supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select(
        "account_id, account_code, account_name, account_type, cost_center_country, doc_debit_amount, doc_credit_amount, is_cash, is_bank, is_tenant_account, is_fixed_asset_account",
      )
      .eq("company_id", companyId)
      .or(
        `cost_center_country.in.(AE,UAE,PK)${
          countryAccountIds.length ? `,account_id.in.(${countryAccountIds.join(",")})` : ""
        }`,
      );

    const byAccount = new Map<string, { id: string; name: string; debit: number; credit: number }>();
    for (const r of data ?? []) {
      // Same attribution as the card total: cost centre first, else the
      // account's own country (codes normalised). Skip lines from another country.
      const country = normCountry(
        (r.cost_center_country as string | null) ?? coaCountryById.get(r.account_id as string),
      );
      if (country !== normCountry(cfg.ccCountry)) continue;
      if (isExcludedFromBalances(r) || fixedAssetAccountIds.has(r.account_id as string)) continue;
      const k = r.account_code as string;
      const a = byAccount.get(k) ?? { id: r.account_id as string, name: r.account_name as string, debit: 0, credit: 0 };
      a.debit += Number(r.doc_debit_amount);
      a.credit += Number(r.doc_credit_amount);
      byAccount.set(k, a);
    }
    const rows = [...byAccount.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const totalDebit = rows.reduce((s, [, a]) => s + a.debit, 0);
    const totalCredit = rows.reduce((s, [, a]) => s + a.credit, 0);

    return {
      title: `Balances — ${cfg.label}`,
      body: (
        <Table className="[&_td]:first:pl-5 [&_td]:last:pr-5 [&_th]:first:pl-5 [&_th]:last:pr-5">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([code, a]) => {
              const net = a.debit - a.credit;
              return (
                <TableRow key={code}>
                  <TableCell>
                    <Link
                      href={`/reports/general-ledger?accountIds=${a.id}`}
                      className="hover:underline"
                      title="Open ledger"
                    >
                      <span className="font-mono text-xs text-muted-foreground">{formatAccountCode(code)}</span>{" "}
                      <span className="text-primary">{a.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{fmt(a.debit)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{fmt(a.credit)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmt(Math.abs(net))} {net >= 0 ? "Dr" : "Cr"}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No postings for {cfg.label} yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {rows.length > 0 && (
            <tfoot className="border-t bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableCell className="font-medium">Total</TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(totalDebit)}</TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(totalCredit)}</TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">
                  {fmt(Math.abs(totalDebit - totalCredit))} {totalDebit - totalCredit >= 0 ? "Dr" : "Cr"}
                </TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      ),
    };
  }

  // Rent detail — invoices for the country, in the country currency. Rent is the
  // gross billed to the tenant; Management is the agent (SAMAD RENT) cut; Balance
  // Rent is the owner's net rent; Outstanding is the still-uncollected net rent.
  // Zero-outstanding (fully-paid) invoices are kept in the list, not hidden.
  let rentQuery = supabase
    .schema("reporting")
    .from("v_rental_income")
    .select(
      "invoice_id, voucher_no, invoice_date, due_date, tenant_name, asset_code, asset_name, amount, agent_share, net_amount, other_expenses, net_outstanding",
    )
    .eq("company_id", companyId)
    .eq("country", cfg.rentCountry);
  if (dateFrom) rentQuery = rentQuery.gte("invoice_date", dateFrom);
  if (dateTo) rentQuery = rentQuery.lte("invoice_date", dateTo);
  const { data } = await rentQuery.order("due_date");

  const rawRows = data ?? [];
  type RentRow = (typeof rawRows)[number] & { _rowKey?: string };
  let rows: RentRow[] = rawRows as RentRow[];

  // Spread a combined HH/UAE invoice (one voucher for a multi-month period) into
  // monthly rows, so the Rent Balance shows the rent due each month — current
  // month due, later months upcoming — while the ledger keeps a single entry.
  if (cfg.rentCountry === "UAE") {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const monthFirsts = billingMonthStarts;

    const ids = rawRows.map((r) => r.invoice_id as string).filter(Boolean);
    const { data: invMeta } = ids.length
      ? await supabase
          .schema("rental")
          .from("uae_rent_invoices")
          .select("id, lease_id, schedule_id")
          .in("id", ids)
      : { data: [] };
    const metaById = new Map(
      ((invMeta as { id: string; lease_id: string; schedule_id: string | null }[]) ?? []).map((m) => [m.id, m]),
    );

    // A combined voucher holds ONE invoice for MANY properties. Resolve it to
    // the voucher's property leases (shared document number) so the Rent Balance
    // lists every property, month by month — current month due, later months
    // upcoming — even though the ledger keeps a single combined entry. The
    // invoice's own row in v_rental_income only carries the first property, which
    // is why the others (e.g. SHAMAL) never appeared here before.
    const firstLeaseIds = [...new Set([...metaById.values()].map((m) => m.lease_id).filter(Boolean))];
    const { data: firstLeases } = firstLeaseIds.length
      ? await supabase
          .schema("rental")
          .from("uae_leases")
          .select("id, document_no")
          .in("id", firstLeaseIds)
      : { data: [] };
    const docByFirstLease = new Map(
      ((firstLeases as { id: string; document_no: string | null }[]) ?? []).map((l) => [l.id, l.document_no]),
    );
    const docNos = [...new Set([...docByFirstLease.values()].filter((d): d is string => Boolean(d)))];

    type VLease = {
      id: string;
      document_no: string | null;
      asset_id: string | null;
      rental_amount: number;
      lease_start: string;
      lease_end: string;
      lease_type: string | null;
    };
    const { data: voucherLeases } = docNos.length
      ? await supabase
          .schema("rental")
          .from("uae_leases")
          .select("id, document_no, asset_id, rental_amount, lease_start, lease_end, lease_type")
          .in("document_no", docNos)
          .is("deleted_at", null)
          .order("created_at")
      : { data: [] };
    const leasesByDoc = new Map<string, VLease[]>();
    for (const l of (voucherLeases as VLease[]) ?? []) {
      const k = l.document_no as string;
      const list = leasesByDoc.get(k) ?? [];
      list.push(l);
      leasesByDoc.set(k, list);
    }

    const assetIds = [...new Set(((voucherLeases as VLease[]) ?? []).map((l) => l.asset_id).filter(Boolean))] as string[];
    const { data: assetRows } = assetIds.length
      ? await supabase.schema("assets").from("assets").select("id, asset_code, asset_name").in("id", assetIds)
      : { data: [] };
    const assetById = new Map(
      ((assetRows as { id: string; asset_code: string; asset_name: string }[]) ?? []).map((a) => [a.id, a]),
    );

    const leaseIdsAll = ((voucherLeases as VLease[]) ?? []).map((l) => l.id);
    // Per-property payment terms — its own error-tolerant query, so the dashboard
    // works before the uae_leases.payment_terms migration (defaults to monthly).
    const { data: termRows } = leaseIdsAll.length
      ? await supabase.schema("rental").from("uae_leases").select("id, payment_terms").in("id", leaseIdsAll)
      : { data: [] };
    const termsByLease = new Map(
      ((termRows as { id: string; payment_terms: string | null }[]) ?? []).map((t) => [t.id, t.payment_terms]),
    );
    const { data: expRows } = leaseIdsAll.length
      ? await supabase.schema("rental").from("lease_expenses").select("lease_id, amount").in("lease_id", leaseIdsAll)
      : { data: [] };
    const expByLease = new Map<string, number>();
    for (const e of (expRows as { lease_id: string; amount: number }[]) ?? []) {
      expByLease.set(e.lease_id, (expByLease.get(e.lease_id) ?? 0) + Number(e.amount));
    }

    rows = rawRows.flatMap((r) => {
      const meta = metaById.get(r.invoice_id as string);
      const docNo = meta ? docByFirstLease.get(meta.lease_id) : null;
      const vLeasesRaw = docNo ? leasesByDoc.get(docNo) ?? [] : [];
      // Guard the display: if a stray duplicate lease exists for the same
      // property in a voucher, keep only the most recent so a property never
      // shows twice here (leases come ordered oldest-first, so the last wins).
      const byAsset = new Map<string, VLease>();
      for (const l of vLeasesRaw) if (l.asset_id) byAsset.set(l.asset_id, l);
      const vLeases = [...byAsset.values()];
      // Not an expandable combined voucher (schedule-based, or leases missing) →
      // keep the invoice's single row as-is.
      if (!meta || meta.schedule_id || vLeases.length === 0) return [{ ...r } as RentRow];

      // Preserve the invoice's paid proportion so a part-paid voucher still shows
      // the right outstanding per property/month.
      const invNet = Number(r.net_amount) || 0;
      const invOut = Number(r.net_outstanding) || 0;
      const paidRatio = invNet > 0 ? invOut / invNet : 1;

      const out: RentRow[] = [];
      for (const lease of vLeases) {
        const asset = lease.asset_id ? assetById.get(lease.asset_id) : null;
        const months = monthFirsts(lease.lease_start, lease.lease_end);
        const n = months.length;
        const isHh = lease.lease_type === "hh";
        const monthlyRent = Number(lease.rental_amount) || 0;
        const monthlyShare = round2(monthlyRent * (isHh ? 0.1 : 0.05));
        const fullExp = expByLease.get(lease.id) ?? 0; // whole-period expense total
        // This property's OWN payment terms drive its due schedule.
        const terms = termsByLease.get(lease.id) ?? "monthly";
        const common = {
          asset_code: asset?.asset_code ?? r.asset_code,
          asset_name: asset?.asset_name ?? r.asset_name,
        };
        // Each instalment covers `count` months and falls due in its first month.
        for (const ch of rentDueChunks(months, terms)) {
          const rent = round2(monthlyRent * ch.count);
          const share = round2(monthlyShare * ch.count);
          const exp = round2(fullExp * (ch.count / n));
          const net = round2(rent - share - exp);
          out.push({
            ...r,
            ...common,
            due_date: ch.dueMonth,
            amount: rent,
            agent_share: share,
            other_expenses: exp,
            net_amount: net,
            net_outstanding: round2(net * paidRatio),
            _rowKey: `${r.invoice_id}-${lease.id}-${ch.dueMonth}`,
          } as RentRow);
        }
      }
      return out;
    });
    rows.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  }

  const nowDate = today();
  // PK Rent Balance omits the Management (agent share) and Other Expenses columns
  // — those only apply to UAE/HH leases.
  const showAgentCols = cfg.rentCountry !== "PK";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dueMonth = (d: string | null | undefined) => {
    const m = /^(\d{4})-(\d{2})/.exec(String(d ?? ""));
    return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "—";
  };
  const totals = rows.reduce(
    (acc, r) => ({
      rent: acc.rent + Number(r.amount),
      share: acc.share + Number(r.agent_share),
      expenses: acc.expenses + Number(r.other_expenses),
      net: acc.net + Number(r.net_amount),
      outstanding: acc.outstanding + Number(r.net_outstanding),
    }),
    { rent: 0, share: 0, expenses: 0, net: 0, outstanding: 0 },
  );
  // Per-month subtotals for every amount column (rows are ordered by due date,
  // so months are contiguous), shown as a total row at the end of each month.
  const monthTotals = new Map<
    string,
    { rent: number; share: number; expenses: number; net: number; received: number; outstanding: number }
  >();
  for (const r of rows) {
    const k = String(r.due_date ?? "").slice(0, 7);
    const t = monthTotals.get(k) ?? { rent: 0, share: 0, expenses: 0, net: 0, received: 0, outstanding: 0 };
    const bal = Number(r.net_amount);
    const out = Number(r.net_outstanding);
    t.rent += Number(r.amount);
    t.share += Number(r.agent_share);
    t.expenses += Number(r.other_expenses);
    t.net += bal;
    t.received += bal - out;
    t.outstanding += out;
    monthTotals.set(k, t);
  }

  // Columns: Date, Voucher, Due Month, Due Date, Property, Tenant, Rent,
  // [Management, Other Expenses], Balance Rent, Receipt, Outstanding.
  const colCount = showAgentCols ? 12 : 10;

  return {
    title: `Rent Balance — ${cfg.label}`,
    body: (
      <Table
        className="min-w-[900px] [&_td]:first:pl-5 [&_td]:last:pr-5 [&_th]:first:pl-5 [&_th]:last:pr-5"
        containerClassName="overflow-x-auto"
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Date</TableHead>
            <TableHead>Voucher No</TableHead>
            <TableHead>Due Month</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead className="text-right">Rent</TableHead>
            {showAgentCols && <TableHead className="text-right">Management</TableHead>}
            {showAgentCols && <TableHead className="text-right">Other Expenses</TableHead>}
            <TableHead className="text-right">Balance Rent</TableHead>
            <TableHead className="text-right">Receipt</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.flatMap((r, i) => {
            // net_amount is already the Balance Rent (Rent − Management − Other
            // Expenses); Outstanding = Balance Rent − receipts.
            const balanceRent = Number(r.net_amount);
            const outstanding = Number(r.net_outstanding);
            const received = balanceRent - outstanding;
            const overdue = isRentOverdue(r.due_date as string, nowDate);
            // Fully-paid rows (nothing outstanding) get a light-green background;
            // a still-owing row that is overdue paints only its Outstanding cell red.
            const paid = outstanding <= 0;
            // Rows are ordered by due date, so due months are contiguous. Emit a
            // highlighted month band whenever the due month changes, grouping the
            // list month-wise.
            const monthKey = String(r.due_date ?? "").slice(0, 7);
            const prevKey = i > 0 ? String(rows[i - 1].due_date ?? "").slice(0, 7) : null;
            const mt = monthTotals.get(monthKey) ?? {
              rent: 0,
              share: 0,
              expenses: 0,
              net: 0,
              received: 0,
              outstanding: 0,
            };
            // The month band (green bar) also carries that month's column totals,
            // so no separate subtotal row is needed.
            const bandCell = "bg-ledger/15 py-1.5 text-right font-mono text-xs font-semibold tabular-nums text-ledger dark:bg-ledger/25";
            const monthHeader =
              monthKey !== prevKey ? (
                <TableRow key={`grp-${monthKey}`} className="hover:bg-transparent">
                  <TableCell
                    colSpan={6}
                    className="bg-ledger/15 py-1.5 text-xs font-semibold uppercase tracking-wide text-ledger dark:bg-ledger/25"
                  >
                    {dueMonth(r.due_date as string)}
                  </TableCell>
                  <TableCell className={bandCell}>{fmt(mt.rent)}</TableCell>
                  {showAgentCols && <TableCell className={bandCell}>{fmt(mt.share)}</TableCell>}
                  {showAgentCols && <TableCell className={bandCell}>{fmt(mt.expenses)}</TableCell>}
                  <TableCell className={bandCell}>{fmt(mt.net)}</TableCell>
                  <TableCell className={bandCell}>{fmt(mt.received)}</TableCell>
                  <TableCell className={bandCell}>{fmt(mt.outstanding)}</TableCell>
                </TableRow>
              ) : null;
            const out = [
              monthHeader,
            <TableRow key={r._rowKey ?? r.invoice_id} className={paid ? "bg-emerald-50 dark:bg-emerald-950/30" : undefined}>
              <TableCell className="text-muted-foreground">{formatDate(r.invoice_date)}</TableCell>
              <TableCell>{r.voucher_no ? formatVoucherNo(r.voucher_no) : "Draft"}</TableCell>
              <TableCell className="text-muted-foreground">{dueMonth(r.due_date as string)}</TableCell>
              <TableCell className={overdue ? "text-destructive" : "text-muted-foreground"}>
                {formatDate(r.due_date)}
              </TableCell>
              <TableCell>{r.asset_name}</TableCell>
              <TableCell>{r.tenant_name}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{fmt(Number(r.amount))}</TableCell>
              {showAgentCols && (
                <TableCell className="text-right font-mono tabular-nums">{fmt(Number(r.agent_share))}</TableCell>
              )}
              {showAgentCols && (
                <TableCell className="text-right font-mono tabular-nums">{fmt(Number(r.other_expenses))}</TableCell>
              )}
              <TableCell className="text-right font-mono tabular-nums">{fmt(balanceRent)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{fmt(received)}</TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono tabular-nums",
                  overdue && !paid && "bg-red-100 font-medium text-destructive dark:bg-red-950/40",
                )}
              >
                {fmt(outstanding)}
              </TableCell>
            </TableRow>,
            ];
            return out;
          })}
          {rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                No rent invoices for {cfg.label} in this period.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {rows.length > 0 && (
          <tfoot className="border-t bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={6} className="font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(totals.rent)}</TableCell>
              {showAgentCols && (
                <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(totals.share)}</TableCell>
              )}
              {showAgentCols && (
                <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(totals.expenses)}</TableCell>
              )}
              <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(totals.net)}</TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(totals.net - totals.outstanding)}</TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(totals.outstanding)}</TableCell>
            </TableRow>
          </tfoot>
        )}
      </Table>
    ),
  };
}
