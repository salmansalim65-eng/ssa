import { Fragment, Suspense } from "react";

import Link from "next/link";

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
import { GeneralLedgerFilters } from "@/components/reports/general-ledger-filters";
import { PrintButton } from "@/components/vouchers/print-button";
import { computeRunningBalances } from "@/lib/reports/ledger-balance";
import { loadAccountingPeriodStart } from "@/lib/reports/period";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { accountIdsForCostCentre } from "@/lib/reports/cost-centres";
import { formatAccountCode, formatDate, formatMoney, formatVoucherNo } from "@/lib/format";
import { voucherHref } from "@/lib/vouchers/meta";
import type { AccountType, VoucherType } from "@/types/database.types";

function startOfYear() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const DEBIT_NORMAL: AccountType[] = ["asset", "expense"];

interface LedgerRow {
  journal_entry_id: string;
  entry_date: string;
  due_date: string | null;
  voucher_type: string;
  voucher_id: string;
  voucher_no: string | null;
  cost_center_id: string | null;
  debit_amount: number;
  credit_amount: number;
  // The line's own transaction amount + currency (before base conversion). Used
  // when the line's currency already matches the account's display currency —
  // e.g. a Multi-Currency Journal line whose per-line rate differs from the
  // exchange-rate table, so converting base back by the table rate would be
  // wrong; the stored doc amount is the true figure.
  doc_debit_amount: number;
  doc_credit_amount: number;
  currency_code: string | null;
  description: string | null;
  narration: string | null;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Rent month = the billed period, taken from the entry's due date (e.g. "Aug 2026").
function rentMonthLabel(due: string | null): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(due ?? ""));
  return m ? `${MONTH_ABBR[Number(m[2]) - 1]} ${m[1]}` : "";
}

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{
    accountIds?: string;
    accountId?: string;
    from?: string;
    to?: string;
    cur?: string;
    vtype?: string;
    cc?: string;
    q?: string;
    min?: string;
    max?: string;
  }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const periodStart = await loadAccountingPeriodStart(companyId);
  const from = sp.from ?? periodStart ?? startOfYear();
  const to = sp.to ?? today();
  const accountIds = (sp.accountIds ?? sp.accountId ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const reportingCurrency = sp.cur ?? ""; // "" => each account's own currency
  const vtype = sp.vtype ?? "";
  const costCenterId = sp.cc ?? "";
  const q = (sp.q ?? "").toLowerCase();
  const minAmount = sp.min ? Number(sp.min) : null;
  const maxAmount = sp.max ? Number(sp.max) : null;

  const [{ data: accounts }, { data: companyCurrencies }, { data: costCenters }] = await Promise.all([
    supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, account_code, account_name, account_type, currency_id")
      .eq("company_id", companyId)
      .eq("is_group", false)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("account_code"),
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

  const costCenterOptions = costCenters ?? [];
  const ccNameById = new Map((costCenters ?? []).map((c) => [c.id as string, c.name as string]));

  type RawCurrency = { is_base_currency: boolean; currencies: { id: string; code: string; symbol: string } | null };
  const currencyList = ((companyCurrencies as unknown as RawCurrency[]) ?? []).filter((cc) => cc.currencies);
  const baseCurrency = currencyList.find((cc) => cc.is_base_currency)?.currencies ?? null;
  const currencyOptions = currencyList.map((cc) => ({ id: cc.currencies!.id, code: cc.currencies!.code }));
  const codeById = new Map(currencyOptions.map((c) => [c.id, c.code] as const));
  const symbolById = new Map(currencyList.map((cc) => [cc.currencies!.id, cc.currencies!.symbol] as const));

  // Conversion factor (base -> target currency) at the report's "to" date.
  const factorCache = new Map<string, number>();
  async function factorFor(currencyId: string | null): Promise<number> {
    if (!currencyId || (baseCurrency && currencyId === baseCurrency.id)) return 1;
    if (factorCache.has(currencyId)) return factorCache.get(currencyId)!;
    const { data: rate, error } = await supabase.schema("core").rpc("fn_exchange_rate_to_base", {
      p_company_id: companyId,
      p_currency_id: currencyId,
      p_as_of_date: to,
    });
    // No rate configured -> leave amounts in base rather than failing the report.
    const factor = !error && rate ? 1 / (rate as number) : 1;
    factorCache.set(currencyId, factor);
    return factor;
  }

  const selectedAccounts = (accounts ?? []).filter((a) => accountIds.includes(a.id));

  type Section = {
    account: { id: string; account_code: string; account_name: string };
    currencyCode: string;
    symbol: string;
    isDebitNormal: boolean;
    opening: number;
    rows: (LedgerRow & { balance: number })[];
  };
  const sections: Section[] = [];

  // Accounts that name the chosen cost centre as their default. Their lines
  // belong to it even when the voucher was raised without one, so for those
  // accounts an untagged line counts too.
  const ccAccountIds = new Set(await accountIdsForCostCentre(companyId, costCenterId));

  for (const acc of selectedAccounts) {
    // Whichever filter this account needs, applied the same way to both queries.
    const untaggedCounts = ccAccountIds.has(acc.id as string);
    const byCostCentre = <T extends { eq: (c: string, v: string) => T; or: (f: string) => T }>(q: T): T => {
      if (!costCenterId) return q;
      return untaggedCounts
        ? q.or(`cost_center_id.eq.${costCenterId},cost_center_id.is.null`)
        : q.eq("cost_center_id", costCenterId);
    };
    const isDebitNormal = DEBIT_NORMAL.includes(acc.account_type);
    // Show each account in its true currency: the report-wide reporting currency
    // if chosen, else the account's own configured currency, else — when the
    // account has no currency set — the currency its own transactions were
    // booked in (so a PKR/SAR/USD account shows PKR/SAR/USD, not base AED).
    let resolvedCurrencyId: string | null = reportingCurrency || acc.currency_id || null;
    if (!resolvedCurrencyId) {
      const { data: txCurrencies } = await supabase
        .schema("accounting")
        .from("journal_entry_lines")
        .select("currency_id")
        .eq("account_id", acc.id)
        .limit(500);
      const distinct = [...new Set((txCurrencies ?? []).map((l) => l.currency_id).filter(Boolean))];
      if (distinct.length === 1) resolvedCurrencyId = distinct[0] as string;
    }
    const targetCurrencyId = resolvedCurrencyId || baseCurrency?.id || null;
    const factor = await factorFor(targetCurrencyId);
    const currencyCode = (targetCurrencyId ? codeById.get(targetCurrencyId) : baseCurrency?.code) ?? "";
    const symbol = (targetCurrencyId ? symbolById.get(targetCurrencyId) : baseCurrency?.symbol) ?? currencyCode;

    // A line already booked in the display currency shows its stored doc amount;
    // anything else is converted from base by the table rate.
    const toDisplay = (base: number, doc: number, code: string | null) =>
      code && code === currencyCode ? doc : round2(base * factor);

    let priorQuery = supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select("debit_amount, credit_amount, doc_debit_amount, doc_credit_amount, currency_code")
      .eq("company_id", companyId)
      .eq("account_id", acc.id)
      .lt("entry_date", from);
    priorQuery = byCostCentre(priorQuery);
    const { data: priorLines } = await priorQuery;
    const priorDebit = ((priorLines as unknown as LedgerRow[]) ?? []).reduce(
      (sum, l) => sum + toDisplay(l.debit_amount, l.doc_debit_amount, l.currency_code),
      0,
    );
    const priorCredit = ((priorLines as unknown as LedgerRow[]) ?? []).reduce(
      (sum, l) => sum + toDisplay(l.credit_amount, l.doc_credit_amount, l.currency_code),
      0,
    );
    const opening = round2(isDebitNormal ? priorDebit - priorCredit : priorCredit - priorDebit);

    let lineQuery = supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select(
        "journal_entry_id, entry_date, due_date, voucher_type, voucher_id, voucher_no, cost_center_id, debit_amount, credit_amount, doc_debit_amount, doc_credit_amount, currency_code, description, narration",
      )
      .eq("company_id", companyId)
      .eq("account_id", acc.id)
      .gte("entry_date", from)
      .lte("entry_date", to);
    lineQuery = byCostCentre(lineQuery);
    const { data: lineRows } = await lineQuery
      .order("entry_date")
      .order("voucher_no", { nullsFirst: false })
      .order("line_no");

    let rows = ((lineRows as unknown as LedgerRow[]) ?? []).map((r) => ({
      ...r,
      debit_amount: toDisplay(r.debit_amount, r.doc_debit_amount, r.currency_code),
      credit_amount: toDisplay(r.credit_amount, r.doc_credit_amount, r.currency_code),
    }));

    // Column filters (applied to the displayed period rows).
    if (vtype) rows = rows.filter((r) => r.voucher_type === vtype);
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.voucher_no ?? "").toLowerCase().includes(q) ||
          (r.narration ?? "").toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q),
      );
    }
    if (minAmount != null) rows = rows.filter((r) => r.debit_amount + r.credit_amount >= minAmount);
    if (maxAmount != null) rows = rows.filter((r) => r.debit_amount + r.credit_amount <= maxAmount);

    sections.push({
      account: acc,
      currencyCode,
      symbol,
      isDebitNormal,
      opening,
      rows: computeRunningBalances(opening, isDebitNormal, rows),
    });
  }

  // Rent month per rent-invoice voucher, taken from the invoice's own billing
  // period (UAE: period_start; PK bills monthly on the invoice due date) rather
  // than the ledger line's due date.
  const rentMonthByVoucher = new Map<string, string>();
  {
    const uaeIds = new Set<string>();
    const pkIds = new Set<string>();
    for (const s of sections)
      for (const r of s.rows) {
        if (!r.voucher_id) continue;
        if (r.voucher_type === "uae_rent_invoice") uaeIds.add(r.voucher_id);
        else if (r.voucher_type === "pk_rent_invoice") pkIds.add(r.voucher_id);
      }
    const [uaeInv, pkInv] = await Promise.all([
      uaeIds.size
        ? supabase.schema("rental").from("uae_rent_invoices").select("id, period_start").in("id", [...uaeIds])
        : Promise.resolve({ data: [] as { id: string; period_start: string | null }[] }),
      pkIds.size
        ? supabase.schema("rental").from("pk_rent_invoices").select("id, due_date").in("id", [...pkIds])
        : Promise.resolve({ data: [] as { id: string; due_date: string | null }[] }),
    ]);
    for (const r of (uaeInv.data ?? []) as { id: string; period_start: string | null }[])
      rentMonthByVoucher.set(r.id, rentMonthLabel(r.period_start));
    for (const r of (pkInv.data ?? []) as { id: string; due_date: string | null }[])
      rentMonthByVoucher.set(r.id, rentMonthLabel(r.due_date));
  }
  const rentMonthFor = (r: { voucher_id: string }) => rentMonthByVoucher.get(r.voucher_id) ?? "";

  // Balance as a magnitude + Dr/Cr, matching the on-screen column.
  const balanceLabel = (n: number, isDebitNormal: boolean) => {
    if (Math.abs(n) < 0.005) return "0";
    const isDr = isDebitNormal ? n >= 0 : n < 0;
    return `${Math.abs(n)} ${isDr ? "Dr" : "Cr"}`;
  };
  const csvRows = sections.flatMap((s) =>
    s.rows.map((r, i) => [
      i + 1,
      formatDate(r.entry_date),
      r.due_date ? formatDate(r.due_date) : "",
      rentMonthFor(r),
      r.voucher_no ? formatVoucherNo(r.voucher_no) : "",
      (r.cost_center_id && ccNameById.get(r.cost_center_id)) || "",
      s.currencyCode,
      r.description || r.narration || "",
      r.debit_amount,
      r.credit_amount,
      balanceLabel(r.balance, s.isDebitNormal),
    ]),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="General Ledger"
        description="Posted transactions with running balances. Select one or more accounts; amounts default to each account's currency."
        className="print:hidden"
        actions={
          <>
            <CsvExportButton
              filename={`general-ledger-${from}-to-${to}.csv`}
              headers={["S.No", "Date", "Due Date", "Rent Month", "Voucher No", "Unit / Cost Centre", "Currency", "Narration", "Debit", "Credit", "Balance"]}
              rows={csvRows}
            />
            <PrintButton />
          </>
        }
      />

      {/* Filters lead the page: account search, dates and currency sit above the
          results, always visible, so a new search never hides below the ledger. */}
      <Suspense>
        <GeneralLedgerFilters
          accounts={accounts ?? []}
          currencies={currencyOptions}
          baseCurrencyId={baseCurrency?.id ?? ""}
          costCenters={costCenterOptions}
          defaultAccountIds={accountIds}
          defaultFrom={from}
          defaultTo={to}
          defaultCurrency={reportingCurrency}
          defaultVoucherType={vtype}
          defaultCostCenter={costCenterId}
          defaultQuery={sp.q ?? ""}
          defaultMin={sp.min ?? ""}
          defaultMax={sp.max ?? ""}
          collapsedByDefault={false}
        />
      </Suspense>

      {selectedAccounts.length > 0 && (
        <div className="rounded-lg border border-ledger/30 bg-ledger/10 px-4 py-2.5 print:border print:bg-transparent">
          <p className="text-sm font-medium text-foreground">
            Ledger period:{" "}
            <span className="text-muted-foreground">
              {formatDate(from)} — {formatDate(to)}
            </span>
          </p>
        </div>
      )}

      {selectedAccounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Select one or more accounts to view their ledger.</p>
      ) : (
        <Table
          className="min-w-[1000px]"
          containerClassName="max-h-[70vh] overflow-auto rounded-lg border bg-card shadow-xs print:max-h-none print:overflow-visible"
        >
            <TableHeader className="sticky top-0 z-20">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12 text-right">S.No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Rent Month</TableHead>
                <TableHead>Voucher No</TableHead>
                <TableHead>Unit / Cost Centre</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sections.map((s) => {
                const money = (n: number) => `${s.symbol} ${formatMoney(n)}`;
                // Running balance as a magnitude with a Dr/Cr suffix (never a bare
                // negative): a debit-normal account is Dr when its natural balance
                // is positive, a credit-normal account is Dr when it's negative.
                const bal = (n: number) => {
                  if (Math.abs(n) < 0.005) return `${s.symbol} 0`;
                  const isDr = s.isDebitNormal ? n >= 0 : n < 0;
                  return `${s.symbol} ${formatMoney(Math.abs(n))} ${isDr ? "Dr" : "Cr"}`;
                };
                const sectionDebit = round2(s.rows.reduce((a, r) => a + r.debit_amount, 0));
                const sectionCredit = round2(s.rows.reduce((a, r) => a + r.credit_amount, 0));
                const closing = s.rows.length ? s.rows[s.rows.length - 1].balance : s.opening;
                // Rows sharing a due month are banded together; each successive
                // due-month group alternates a light grey shade so periods read
                // apart at a glance.
                let dueGrp = -1;
                let prevDueKey: string | null = null;
                const shaded = s.rows.map((r) => {
                  const key = (r.due_date ?? "").slice(0, 7);
                  if (key !== prevDueKey) {
                    dueGrp += 1;
                    prevDueKey = key;
                  }
                  return dueGrp % 2 === 1;
                });
                return (
                <Fragment key={s.account.id}>
                  <TableRow className="bg-ledger/10">
                    <TableCell colSpan={5} className="font-medium">
                      <span className="font-mono text-xs text-muted-foreground">{formatAccountCode(s.account.account_code)}</span>{" "}
                      <span className="font-semibold text-foreground">{s.account.account_name}</span>{" "}
                      <span className="font-normal text-muted-foreground">({s.currencyCode})</span>
                    </TableCell>
                    <TableCell colSpan={4} className="text-right font-medium text-muted-foreground">
                      Opening balance
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">
                      {bal(s.opening)}
                    </TableCell>
                  </TableRow>
                  {s.rows.map((r, i) => (
                    <TableRow
                      key={`${r.journal_entry_id}-${r.entry_date}-${r.voucher_no ?? ""}`}
                      className={shaded[i] ? "bg-foreground/[0.07] hover:bg-foreground/[0.07]" : undefined}
                    >
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>{formatDate(r.entry_date)}</TableCell>
                      <TableCell>{r.due_date ? formatDate(r.due_date) : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{rentMonthFor(r) || "—"}</TableCell>
                      <TableCell>
                        {r.voucher_no ? (
                          <Link
                            href={voucherHref(r.voucher_type as VoucherType, r.voucher_id)}
                            className="font-medium text-primary hover:underline"
                          >
                            {formatVoucherNo(r.voucher_no)}
                          </Link>
                        ) : (
                          "Draft"
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{(r.cost_center_id && ccNameById.get(r.cost_center_id)) || "—"}</TableCell>
                      <TableCell>{r.description || r.narration || "—"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {r.debit_amount ? money(r.debit_amount) : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {r.credit_amount ? money(r.credit_amount) : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{bal(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                  {s.rows.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                        No transactions match the filters in this period.
                      </TableCell>
                    </TableRow>
                  )}
                  {s.rows.length > 0 && (
                    <TableRow className="border-t-2 border-ledger/50 bg-ledger/25 hover:bg-ledger/25">
                      <TableCell colSpan={7} className="text-right font-semibold text-foreground">
                        Total — {formatAccountCode(s.account.account_code)} {s.account.account_name}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums">
                        {money(sectionDebit)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums">
                        {money(sectionCredit)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums">
                        {bal(closing)}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
                );
              })}
            </TableBody>
          </Table>
      )}
    </div>
  );
}
