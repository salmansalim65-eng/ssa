import Link from "next/link";
import { AlertCircleIcon, TrendingUpIcon, WalletIcon } from "lucide-react";

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
import { PageHeader } from "@/components/ui/page-header";
import { VoucherStatusBadge } from "@/components/vouchers/voucher-status-badge";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { VOUCHER_TYPE_LABELS, voucherHref } from "@/lib/vouchers/meta";
import type { VoucherType } from "@/types/database.types";

function today() {
  return new Date().toISOString().slice(0, 10);
}
function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}
function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
}

// The four summary cards. Each keys off a country: ledger balances use the ISO
// cost-centre country ('AE' / 'PK'); rental income uses its label ('UAE' / 'PK').
const BALANCE_PANELS = {
  "balances-uae": { kind: "balances", ccCountry: "AE", label: "UAE" },
  "balances-pk": { kind: "balances", ccCountry: "PK", label: "Pakistan" },
  "rent-uae": { kind: "rent", rentCountry: "UAE", label: "UAE" },
  "rent-pk": { kind: "rent", rentCountry: "PK", label: "Pakistan" },
} as const;
type PanelKey = keyof typeof BALANCE_PANELS;

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
    { data: monthlyInvoices },
    { data: yearlyInvoices },
    { count: pendingApprovals },
    { data: baseCurrency },
    { data: recentVouchers },
  ] = await Promise.all([
    supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select("cost_center_country, debit_amount, credit_amount")
      .eq("company_id", companyId)
      .in("cost_center_country", ["AE", "PK"]),
    supabase
      .schema("reporting")
      .from("v_rental_income")
      .select("country, amount, outstanding_balance, due_date, exchange_rate")
      .eq("company_id", companyId)
      .in("country", ["UAE", "PK"]),
    supabase
      .schema("reporting")
      .from("v_rental_income")
      .select("amount")
      .eq("company_id", companyId)
      .gte("invoice_date", monthStart())
      .lte("invoice_date", today()),
    supabase
      .schema("reporting")
      .from("v_rental_income")
      .select("amount")
      .eq("company_id", companyId)
      .gte("invoice_date", yearStart())
      .lte("invoice_date", today()),
    supabase
      .schema("accounting")
      .from("voucher_approvals")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "pending"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("currencies:currency_id(symbol)")
      .eq("company_id", companyId)
      .eq("is_base_currency", true)
      .maybeSingle(),
    supabase
      .schema("accounting")
      .from("v_voucher_register")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const baseSymbol =
    (baseCurrency as unknown as { currencies: { symbol: string } | null } | null)?.currencies?.symbol ?? "";
  const money = (n: number) => (baseSymbol ? `${baseSymbol} ${formatMoney(n)}` : formatMoney(n));
  const drCr = (net: number) => `${money(Math.abs(net))} ${net >= 0 ? "Dr" : "Cr"}`;

  // Ledger balances (base currency) per country.
  const balByCountry: Record<string, { debit: number; credit: number }> = {
    AE: { debit: 0, credit: 0 },
    PK: { debit: 0, credit: 0 },
  };
  for (const r of ledgerRows ?? []) {
    const b = balByCountry[r.cost_center_country as string];
    if (!b) continue;
    b.debit += Number(r.debit_amount);
    b.credit += Number(r.credit_amount);
  }

  // Rent balances (converted to base at each invoice's booking rate) per country.
  const rentByCountry: Record<string, { billed: number; outstanding: number; overdue: number; due: number }> = {
    UAE: { billed: 0, outstanding: 0, overdue: 0, due: 0 },
    PK: { billed: 0, outstanding: 0, overdue: 0, due: 0 },
  };
  const now = today();
  for (const r of rentRows ?? []) {
    const g = rentByCountry[r.country as string];
    if (!g) continue;
    const rate = Number(r.exchange_rate) || 1;
    const billed = Number(r.amount) * rate;
    const outstanding = Number(r.outstanding_balance) * rate;
    g.billed += billed;
    g.outstanding += outstanding;
    if (r.due_date < now) g.overdue += outstanding;
    else g.due += outstanding;
  }
  const rentReceipts = (c: string) => rentByCountry[c].billed - rentByCountry[c].outstanding;

  const monthlyRentalIncome = (monthlyInvoices ?? []).reduce((s, r) => s + r.amount, 0);
  const yearlyRentalIncome = (yearlyInvoices ?? []).reduce((s, r) => s + r.amount, 0);
  const totalOutstandingRent =
    rentByCountry.UAE.outstanding + rentByCountry.PK.outstanding;

  const selected = (panel in BALANCE_PANELS ? panel : "") as PanelKey | "";
  const detail = selected ? await loadDetail(companyId, selected, baseSymbol) : null;

  function cardHref(key: PanelKey) {
    return selected === key ? "/dashboard" : `/dashboard?panel=${key}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Balances and rent position by country. Click a card to open its detail below."
      />

      {/* Four country balance cards — click to open the detail report below. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Balances UAE" href={cardHref("balances-uae")} active={selected === "balances-uae"}>
          <div className="flex justify-between gap-2">
            <StatCol value={money(balByCountry.AE.debit)} label="Debit" />
            <StatCol value={money(balByCountry.AE.credit)} label="Credit" align="right" />
          </div>
          <div className="border-t pt-2 text-center text-lg font-bold tabular-nums">
            {drCr(balByCountry.AE.debit - balByCountry.AE.credit)}
          </div>
        </SummaryCard>

        <SummaryCard title="Balances PK" href={cardHref("balances-pk")} active={selected === "balances-pk"}>
          <div className="flex justify-between gap-2">
            <StatCol value={money(balByCountry.PK.debit)} label="Debit" />
            <StatCol value={money(balByCountry.PK.credit)} label="Credit" align="right" />
          </div>
          <div className="border-t pt-2 text-center text-lg font-bold tabular-nums">
            {drCr(balByCountry.PK.debit - balByCountry.PK.credit)}
          </div>
        </SummaryCard>

        <SummaryCard title="Rent Balance UAE" href={cardHref("rent-uae")} active={selected === "rent-uae"}>
          <div className="grid grid-cols-3 gap-2">
            <StatCol value={money(rentByCountry.UAE.overdue)} label="Overdue" />
            <StatCol value={money(rentByCountry.UAE.due)} label="Due" align="center" />
            <StatCol value={money(rentByCountry.UAE.billed)} label="Total" align="right" />
          </div>
          <div className="flex items-center justify-between border-t pt-2">
            <StatCol value={money(rentReceipts("UAE"))} label="Receipts" />
            <div className="text-right text-base font-bold tabular-nums">
              Balance: {money(rentByCountry.UAE.outstanding)}
            </div>
          </div>
        </SummaryCard>

        <SummaryCard title="Rent Balance PK" href={cardHref("rent-pk")} active={selected === "rent-pk"}>
          <div className="grid grid-cols-3 gap-2">
            <StatCol value={money(rentByCountry.PK.overdue)} label="Overdue" />
            <StatCol value={money(rentByCountry.PK.due)} label="Due" align="center" />
            <StatCol value={money(rentByCountry.PK.billed)} label="Total" align="right" />
          </div>
          <div className="flex items-center justify-between border-t pt-2">
            <StatCol value={money(rentReceipts("PK"))} label="Receipts" />
            <div className="text-right text-base font-bold tabular-nums">
              Balance: {money(rentByCountry.PK.outstanding)}
            </div>
          </div>
        </SummaryCard>
      </div>

      {/* Detail report for the selected card. */}
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

      {/* Secondary KPIs. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Rental income (month)"
          value={money(monthlyRentalIncome)}
          icon={TrendingUpIcon}
          href="/reports/rental-income"
        />
        <KpiCard
          label="Rental income (year)"
          value={money(yearlyRentalIncome)}
          icon={TrendingUpIcon}
          href="/reports/rental-income"
        />
        <KpiCard
          label="Outstanding rent"
          value={money(totalOutstandingRent)}
          icon={WalletIcon}
          tone={totalOutstandingRent > 0 ? "warning" : undefined}
          href="/reports/outstanding-rent"
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

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>Recent transactions</CardTitle>
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link href="/accounting/voucher-register">View all</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
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
              {(recentVouchers ?? []).map((row) => (
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
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.amount)}</TableCell>
                  <TableCell>
                    <VoucherStatusBadge status={row.status} />
                  </TableCell>
                </TableRow>
              ))}
              {(recentVouchers ?? []).length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No transactions yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// Detail report for a selected card: a per-account trial balance (balances
// cards) or the outstanding rent list (rent cards), both scoped to the country.
async function loadDetail(companyId: string, key: PanelKey, baseSymbol: string) {
  const supabase = await createClient();
  const cfg = BALANCE_PANELS[key];
  const money = (n: number) => (baseSymbol ? `${baseSymbol} ${formatMoney(n)}` : formatMoney(n));

  if (cfg.kind === "balances") {
    const { data } = await supabase
      .schema("reporting")
      .from("v_ledger_entries")
      .select("account_code, account_name, debit_amount, credit_amount")
      .eq("company_id", companyId)
      .eq("cost_center_country", cfg.ccCountry);

    const byAccount = new Map<string, { name: string; debit: number; credit: number }>();
    for (const r of data ?? []) {
      const k = r.account_code as string;
      const a = byAccount.get(k) ?? { name: r.account_name as string, debit: 0, credit: 0 };
      a.debit += Number(r.debit_amount);
      a.credit += Number(r.credit_amount);
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
                  <TableCell className="text-right font-mono tabular-nums">{money(a.debit)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{money(a.credit)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {money(Math.abs(net))} {net >= 0 ? "Dr" : "Cr"}
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
                <TableCell className="text-right font-mono font-semibold tabular-nums">{money(totalDebit)}</TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">{money(totalCredit)}</TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">
                  {money(Math.abs(totalDebit - totalCredit))} {totalDebit - totalCredit >= 0 ? "Dr" : "Cr"}
                </TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      ),
    };
  }

  // Rent detail — outstanding invoices for the country, converted to base.
  const { data } = await supabase
    .schema("reporting")
    .from("v_rental_income")
    .select("invoice_id, voucher_no, due_date, tenant_name, asset_code, asset_name, amount, outstanding_balance, exchange_rate")
    .eq("company_id", companyId)
    .eq("country", cfg.rentCountry)
    .gt("outstanding_balance", 0)
    .order("due_date");

  const rows = data ?? [];
  const totalOutstanding = rows.reduce((s, r) => s + Number(r.outstanding_balance) * (Number(r.exchange_rate) || 1), 0);
  const nowDate = today();

  return {
    title: `Rent Balance — ${cfg.label}`,
    body: (
      <Table className="[&_td]:first:pl-5 [&_td]:last:pr-5 [&_th]:first:pl-5 [&_th]:last:pr-5">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Voucher No</TableHead>
            <TableHead>Due date</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead>Property</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.invoice_id}>
              <TableCell>{r.voucher_no ?? "Draft"}</TableCell>
              <TableCell className={r.due_date < nowDate ? "text-destructive" : "text-muted-foreground"}>
                {formatDate(r.due_date)}
              </TableCell>
              <TableCell>{r.tenant_name}</TableCell>
              <TableCell>
                <span className="font-mono text-xs text-muted-foreground">{r.asset_code}</span> {r.asset_name}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {money(Number(r.outstanding_balance) * (Number(r.exchange_rate) || 1))}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                No outstanding rent for {cfg.label}.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {rows.length > 0 && (
          <tfoot className="border-t bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="font-medium">
                Total outstanding
              </TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">{money(totalOutstanding)}</TableCell>
            </TableRow>
          </tfoot>
        )}
      </Table>
    ),
  };
}
