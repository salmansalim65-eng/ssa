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
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { createClient } from "@/lib/supabase/server";
import { fetchRefs } from "@/lib/supabase/hydrate";
import { formatDate, formatMoney } from "@/lib/format";
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
  debit_amount: number;
  credit_amount: number;
  description: string | null;
  narration: string | null;
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
  const from = sp.from ?? startOfYear();
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

  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

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
    opening: number;
    counterpartByJe: Map<string, string>;
    rows: (LedgerRow & { balance: number })[];
  };
  const sections: Section[] = [];

  for (const acc of selectedAccounts) {
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

    let priorQuery = supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select("debit_amount, credit_amount")
      .eq("company_id", companyId)
      .eq("account_id", acc.id)
      .lt("entry_date", from);
    if (costCenterId) priorQuery = priorQuery.eq("cost_center_id", costCenterId);
    const { data: priorLines } = await priorQuery;
    const priorDebit = (priorLines ?? []).reduce((sum, l) => sum + l.debit_amount, 0);
    const priorCredit = (priorLines ?? []).reduce((sum, l) => sum + l.credit_amount, 0);
    const openingBase = isDebitNormal ? priorDebit - priorCredit : priorCredit - priorDebit;
    const opening = round2(openingBase * factor);

    let lineQuery = supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select(
        "journal_entry_id, entry_date, due_date, voucher_type, voucher_id, voucher_no, debit_amount, credit_amount, description, narration",
      )
      .eq("company_id", companyId)
      .eq("account_id", acc.id)
      .gte("entry_date", from)
      .lte("entry_date", to);
    if (costCenterId) lineQuery = lineQuery.eq("cost_center_id", costCenterId);
    const { data: lineRows } = await lineQuery
      .order("entry_date")
      .order("voucher_no", { nullsFirst: false })
      .order("line_no");

    // Resolve the counterpart (other side) account name for each journal entry.
    const jeIds = [...new Set(((lineRows as unknown as LedgerRow[]) ?? []).map((r) => r.journal_entry_id))];
    const counterpartByJe = new Map<string, string>();
    if (jeIds.length > 0) {
      const { data: cpLines } = await supabase
        .schema("reporting")
        .from("v_ledger_entries")
        .select("journal_entry_id, account_id")
        .eq("company_id", companyId)
        .in("journal_entry_id", jeIds)
        .neq("account_id", acc.id);
      const cpRows = (cpLines as unknown as { journal_entry_id: string; account_id: string }[]) ?? [];
      const nameById = await fetchRefs<{ id: string; account_name: string }>(
        supabase,
        "accounting",
        "chart_of_accounts",
        "account_name",
        cpRows.map((r) => r.account_id),
      );
      const namesByJe = new Map<string, Set<string>>();
      for (const r of cpRows) {
        const name = nameById.get(r.account_id)?.account_name;
        if (!name) continue;
        if (!namesByJe.has(r.journal_entry_id)) namesByJe.set(r.journal_entry_id, new Set());
        namesByJe.get(r.journal_entry_id)!.add(name);
      }
      for (const [je, names] of namesByJe) {
        counterpartByJe.set(je, names.size === 1 ? [...names][0] : `Split (${names.size})`);
      }
    }

    let rows = ((lineRows as unknown as LedgerRow[]) ?? []).map((r) => ({
      ...r,
      debit_amount: round2(r.debit_amount * factor),
      credit_amount: round2(r.credit_amount * factor),
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
      opening,
      counterpartByJe,
      rows: computeRunningBalances(opening, isDebitNormal, rows),
    });
  }

  const csvRows = sections.flatMap((s) =>
    s.rows.map((r) => [
      formatDate(r.entry_date),
      r.due_date ? formatDate(r.due_date) : "",
      r.voucher_no ?? "",
      `${s.account.account_code} - ${s.account.account_name}`,
      s.currencyCode,
      r.description || r.narration || "",
      r.debit_amount,
      r.credit_amount,
      r.balance,
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
              headers={["Date", "Due Date", "Voucher No", "Account", "Currency", "Narration", "Debit", "Credit", "Balance"]}
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
        <div className="rounded-lg border border-ledger/30 bg-ledger/10 px-4 py-3 print:border print:bg-transparent">
          <p className="text-xs font-semibold uppercase tracking-wide text-ledger">General Ledger</p>
          <p className="mt-0.5 text-lg font-semibold text-foreground">
            {selectedAccounts.map((a) => `${a.account_code} — ${a.account_name}`).join("  •  ")}
          </p>
          <p className="text-sm text-muted-foreground">
            Period: {formatDate(from)} — {formatDate(to)}
          </p>
        </div>
      )}

      {selectedAccounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Select one or more accounts to view their ledger.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card shadow-xs">
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Voucher No</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sections.map((s) => {
                const money = (n: number) => `${s.symbol} ${formatMoney(n)}`;
                return (
                <Fragment key={s.account.id}>
                  <TableRow className="bg-ledger/10">
                    <TableCell colSpan={3} className="font-medium">
                      <span className="font-mono text-xs text-muted-foreground">{s.account.account_code}</span>{" "}
                      <span className="font-semibold text-foreground">{s.account.account_name}</span>{" "}
                      <span className="font-normal text-muted-foreground">({s.currencyCode})</span>
                    </TableCell>
                    <TableCell colSpan={4} className="text-right font-medium text-muted-foreground">
                      Opening balance
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">
                      {money(s.opening)}
                    </TableCell>
                  </TableRow>
                  {s.rows.map((r) => (
                    <TableRow key={`${r.journal_entry_id}-${r.entry_date}-${r.voucher_no ?? ""}`}>
                      <TableCell>{formatDate(r.entry_date)}</TableCell>
                      <TableCell>{r.due_date ? formatDate(r.due_date) : "—"}</TableCell>
                      <TableCell>
                        {r.voucher_no ? (
                          <Link
                            href={voucherHref(r.voucher_type as VoucherType, r.voucher_id)}
                            className="font-medium text-primary hover:underline"
                          >
                            {r.voucher_no}
                          </Link>
                        ) : (
                          "Draft"
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{s.counterpartByJe.get(r.journal_entry_id) ?? "—"}</TableCell>
                      <TableCell>{r.description || r.narration || "—"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {r.debit_amount ? money(r.debit_amount) : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {r.credit_amount ? money(r.credit_amount) : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{money(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                  {s.rows.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                        No transactions match the filters in this period.
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
