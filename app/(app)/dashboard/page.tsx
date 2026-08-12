import Link from "next/link";
import { AlertCircleIcon } from "lucide-react";

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
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { VOUCHER_TYPE_LABELS, voucherHref } from "@/lib/vouchers/meta";
import { isRentOverdue } from "@/lib/rental/overdue";
import type { JournalEntryStatus, VoucherType } from "@/types/database.types";

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Each country card shows figures in that country's own currency.
const BALANCE_PANELS = {
  "balances-uae": { kind: "balances", ccCountry: "AE", rentCountry: "UAE", currency: "AED", label: "UAE" },
  "balances-pk": { kind: "balances", ccCountry: "PK", rentCountry: "PK", currency: "PKR", label: "Pakistan" },
  "rent-uae": { kind: "rent", ccCountry: "AE", rentCountry: "UAE", currency: "AED", label: "UAE" },
  "rent-pk": { kind: "rent", ccCountry: "PK", rentCountry: "PK", currency: "PKR", label: "Pakistan" },
} as const;
type PanelKey = keyof typeof BALANCE_PANELS;

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string }>;
}) {
  const { panel = "" } = await searchParams;
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [
    { data: ledgerRows },
    { data: rentRows },
    { data: cashBankAccounts },
    { data: cashBankLedger },
    { count: pendingApprovals },
    { data: currencies },
    { data: recentVouchers },
  ] = await Promise.all([
    supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select(
        "cost_center_country, account_type, doc_debit_amount, doc_credit_amount, is_cash, is_bank, is_tenant_account, is_fixed_asset_account",
      )
      .eq("company_id", companyId)
      .in("cost_center_country", ["AE", "PK"]),
    supabase
      .schema("reporting")
      .from("v_rental_income")
      .select("country, amount, outstanding_balance, net_amount, net_outstanding, due_date, exchange_rate")
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
      .schema("accounting")
      .from("v_voucher_register")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

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
    const b = balByCountry[r.cost_center_country as string];
    if (!b) continue;
    if (isExcludedFromBalances(r)) continue;
    b.debit += Number(r.doc_debit_amount);
    b.credit += Number(r.doc_credit_amount);
  }

  // Rent figures in each country's own currency (document amounts), NET of the
  // agent/commission share — the owner's rent, not the gross billed to the
  // tenant. (v_rental_income.net_amount = amount − agent_share; net_outstanding
  // is that net reduced pro-rata as the tenant pays.)
  const rentByCountry: Record<string, { billed: number; outstanding: number; overdue: number; due: number }> = {
    UAE: { billed: 0, outstanding: 0, overdue: 0, due: 0 },
    PK: { billed: 0, outstanding: 0, overdue: 0, due: 0 },
  };
  const now = today();
  for (const r of rentRows ?? []) {
    const g = rentByCountry[r.country as string];
    if (!g) continue;
    const netAmount = Number(r.net_amount);
    const netOutstanding = Number(r.net_outstanding);
    g.billed += netAmount;
    g.outstanding += netOutstanding;
    if (isRentOverdue(r.due_date as string, now)) g.overdue += netOutstanding;
    else g.due += netOutstanding;
  }
  const rentReceipts = (c: string) => rentByCountry[c].billed - rentByCountry[c].outstanding;

  const isBank = panel === "bank";
  const isCash = panel === "cash";
  const isRecent = panel === "recent";
  const selected = (panel in BALANCE_PANELS ? panel : "") as PanelKey | "";
  const detail = selected
    ? await loadDetail(companyId, selected, sym(BALANCE_PANELS[selected].currency))
    : isBank
      ? bankDetail(bankOnly, "Bank Balances")
      : isCash
        ? bankDetail(cashOnly, "Cash Balances")
        : isRecent
          ? recentDetail((recentVouchers ?? []) as unknown as RecentVoucherRow[], symById)
          : null;

  function cardHref(key: PanelKey | "bank" | "cash" | "recent") {
    return panel === key ? "/dashboard" : `/dashboard?panel=${key}`;
  }

  const aed = sym("AED");
  const pkr = sym("PKR");
  const drCr = (symbol: string, net: number) => `${money(symbol, Math.abs(net))} ${net >= 0 ? "Dr" : "Cr"}`;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
            <StatCol value={money(aed, balByCountry.AE.debit)} label="Debit" />
            <StatCol value={money(aed, balByCountry.AE.credit)} label="Credit" align="right" />
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
            <StatCol value={money(pkr, balByCountry.PK.debit)} label="Debit" />
            <StatCol value={money(pkr, balByCountry.PK.credit)} label="Credit" align="right" />
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
            <StatCol value={money(aed, rentByCountry.UAE.overdue)} label="Overdue" />
            <StatCol value={money(aed, rentByCountry.UAE.due)} label="Due" align="center" />
            <StatCol value={money(aed, rentByCountry.UAE.billed)} label="Total" align="right" />
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
            <StatCol value={money(pkr, rentByCountry.PK.overdue)} label="Overdue" />
            <StatCol value={money(pkr, rentByCountry.PK.due)} label="Due" align="center" />
            <StatCol value={money(pkr, rentByCountry.PK.billed)} label="Total" align="right" />
          </div>
        </SummaryCard>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          title="Rent Report"
          href="/reports/rent-report"
          footer={
            <div className="text-center text-xs font-medium text-muted-foreground">
              Cost-centre-wise, month-wise rent — open report
            </div>
          }
        >
          <div className="py-1 text-sm text-muted-foreground">
            UAE and Pakistan rent, per cost centre and month.
          </div>
        </SummaryCard>

        <KpiCard
          label="Pending approvals"
          value={(pendingApprovals ?? 0).toLocaleString()}
          subtext="Awaiting a decision"
          icon={AlertCircleIcon}
          tone={(pendingApprovals ?? 0) > 0 ? "warning" : undefined}
          href="/accounting/voucher-register"
        />

        <SummaryCard
          title="Recent Transactions"
          href={cardHref("recent")}
          active={isRecent}
          footer={
            <div className="text-center text-xs font-medium text-muted-foreground">
              {(recentVouchers ?? []).length > 0
                ? "Latest vouchers — click for detail"
                : "No transactions yet"}
            </div>
          }
        >
          {(recentVouchers ?? []).length > 0 ? (
            <div className="space-y-1 text-sm">
              {(recentVouchers ?? []).slice(0, 3).map((row) => (
                <div
                  key={`${row.voucher_type}-${row.voucher_id}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="truncate font-mono text-muted-foreground">{row.voucher_no ?? "Draft"}</span>
                  <span className="shrink-0 font-mono font-medium tabular-nums">
                    {money(symById(row.currency_id), Number(row.doc_amount ?? row.amount))}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-1 text-sm text-muted-foreground">No transactions yet.</div>
          )}
        </SummaryCard>
      </div>

      {/* The selected tab's detail/report renders here — below ALL the cards. */}
      {detail && (
        <Card className="border-ledger-dark/40">
          <CardHeader className="border-b pb-4">
            <CardTitle>{detail.title}</CardTitle>
            <CardAction>
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
  accounts: { code: string; name: string; symbol: string; balance: number }[],
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
                <span className="font-mono text-xs text-muted-foreground">{a.code}</span> {a.name}
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

interface RecentVoucherRow {
  voucher_type: string;
  voucher_id: string;
  voucher_no: string | null;
  entry_date: string;
  currency_id: string | null;
  doc_amount: number | null;
  amount: number | null;
  status: JournalEntryStatus;
}

// Recent Transactions drill-down — the latest vouchers, opened in the detail
// slot from the dashboard tab (mirrors the standalone list it replaced).
function recentDetail(rows: RecentVoucherRow[], symById: (id: string | null) => string) {
  return {
    title: "Recent Transactions",
    body: (
      <Table className="[&_td]:first:pl-5 [&_td]:last:pr-5 [&_th]:first:pl-5 [&_th]:last:pr-5">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Voucher No</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="w-36">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.voucher_type}-${row.voucher_id}`}>
              <TableCell>
                <Link
                  href={voucherHref(row.voucher_type as VoucherType, row.voucher_id)}
                  className="font-mono font-medium text-primary hover:underline"
                >
                  {row.voucher_no ?? "Draft"}
                </Link>
              </TableCell>
              <TableCell>{VOUCHER_TYPE_LABELS[row.voucher_type as VoucherType]}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(row.entry_date)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {money(symById(row.currency_id), Number(row.doc_amount ?? row.amount))}
              </TableCell>
              <TableCell>
                <VoucherStatusBadge status={row.status} />
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                No transactions yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    ),
  };
}

// Detail report for a selected card — figures in the country's own currency.
async function loadDetail(companyId: string, key: PanelKey, symbol: string) {
  const supabase = await createClient();
  const cfg = BALANCE_PANELS[key];
  const fmt = (n: number) => money(symbol, n);

  if (cfg.kind === "balances") {
    const { data } = await supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select(
        "account_code, account_name, account_type, doc_debit_amount, doc_credit_amount, is_cash, is_bank, is_tenant_account, is_fixed_asset_account",
      )
      .eq("company_id", companyId)
      .eq("cost_center_country", cfg.ccCountry);

    const byAccount = new Map<string, { name: string; debit: number; credit: number }>();
    for (const r of data ?? []) {
      if (isExcludedFromBalances(r)) continue;
      const k = r.account_code as string;
      const a = byAccount.get(k) ?? { name: r.account_name as string, debit: 0, credit: 0 };
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
                    <span className="font-mono text-xs text-muted-foreground">{code}</span> {a.name}
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

  // Rent detail — outstanding invoices for the country, in the country currency.
  // Rent is the gross billed to the tenant; Commission/Share is the agent
  // (SAMAD RENT) cut; Balance Rent is the owner's net rent; Outstanding is the
  // still-uncollected net rent.
  const { data } = await supabase
    .schema("reporting")
    .from("v_rental_income")
    .select(
      "invoice_id, voucher_no, invoice_date, due_date, tenant_name, asset_code, asset_name, amount, agent_share, net_amount, net_outstanding",
    )
    .eq("company_id", companyId)
    .eq("country", cfg.rentCountry)
    .gt("net_outstanding", 0)
    .order("due_date");

  const rows = data ?? [];
  const nowDate = today();
  const totals = rows.reduce(
    (acc, r) => ({
      rent: acc.rent + Number(r.amount),
      share: acc.share + Number(r.agent_share),
      net: acc.net + Number(r.net_amount),
      outstanding: acc.outstanding + Number(r.net_outstanding),
    }),
    { rent: 0, share: 0, net: 0, outstanding: 0 },
  );

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
            <TableHead>Due Date</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead>Property</TableHead>
            <TableHead className="text-right">Rent</TableHead>
            <TableHead className="text-right">Commission/Share</TableHead>
            <TableHead className="text-right">Balance Rent</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.invoice_id}>
              <TableCell className="text-muted-foreground">{formatDate(r.invoice_date)}</TableCell>
              <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
              <TableCell className={isRentOverdue(r.due_date as string, nowDate) ? "text-destructive" : "text-muted-foreground"}>
                {formatDate(r.due_date)}
              </TableCell>
              <TableCell>{r.tenant_name}</TableCell>
              <TableCell>
                <span className="font-mono text-xs text-muted-foreground">{r.asset_code}</span> {r.asset_name}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{fmt(Number(r.amount))}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{fmt(Number(r.agent_share))}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{fmt(Number(r.net_amount))}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{fmt(Number(r.net_outstanding))}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                No outstanding rent for {cfg.label}.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {rows.length > 0 && (
          <tfoot className="border-t bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(totals.rent)}</TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(totals.share)}</TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(totals.net)}</TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">{fmt(totals.outstanding)}</TableCell>
            </TableRow>
          </tfoot>
        )}
      </Table>
    ),
  };
}
