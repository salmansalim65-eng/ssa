import Link from "next/link";
import {
  AlertCircleIcon,
  BuildingIcon,
  ClockIcon,
  HomeIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { SimpleBarChart } from "@/components/dashboard/simple-bar-chart";
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

export default async function DashboardPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();

  const [
    { data: assets },
    { data: monthlyInvoices },
    { data: yearlyInvoices },
    { data: outstanding },
    { count: pendingApprovals },
    { data: companyCurrencies },
    { data: exchangeHistory },
    { data: recentVouchers },
  ] = await Promise.all([
    supabase
      .schema("assets")
      .from("assets")
      .select("id, country, property_type, status, current_value")
      .eq("company_id", companyId)
      .is("deleted_at", null),
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
    supabase.schema("reporting").from("v_outstanding_rent").select("outstanding_balance").eq("company_id", companyId),
    supabase
      .schema("accounting")
      .from("voucher_approvals")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "pending"),
    supabase
      .schema("core")
      .from("company_currencies")
      .select("is_base_currency, currencies:currency_id(code)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .schema("reporting")
      .from("v_currency_exchange_history")
      .select("currency_code, rate_date, rate_to_base")
      .eq("company_id", companyId)
      .order("rate_date", { ascending: false }),
    supabase
      .schema("accounting")
      .from("v_voucher_register")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const activeAssets = (assets ?? []).filter((a) => a.status === "active");
  const totalAssets = (assets ?? []).length;
  const totalPropertyValue = activeAssets.reduce((sum, a) => sum + (a.current_value ?? 0), 0);
  const monthlyRentalIncome = (monthlyInvoices ?? []).reduce((sum, r) => sum + r.amount, 0);
  const yearlyRentalIncome = (yearlyInvoices ?? []).reduce((sum, r) => sum + r.amount, 0);
  const totalOutstandingRent = (outstanding ?? []).reduce((sum, r) => sum + r.outstanding_balance, 0);

  const byCountry = new Map<string, number>();
  const byPropertyType = new Map<string, number>();
  for (const a of assets ?? []) {
    byCountry.set(a.country, (byCountry.get(a.country) ?? 0) + 1);
    byPropertyType.set(a.property_type, (byPropertyType.get(a.property_type) ?? 0) + 1);
  }
  const assetsByCountry = Array.from(byCountry.entries()).map(([label, value]) => ({ label, value }));
  const assetsByPropertyType = Array.from(byPropertyType.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  type RawCompanyCurrency = { is_base_currency: boolean; currencies: { code: string } | null };
  const latestRateByCurrency = new Map<string, { rate_date: string; rate_to_base: number }>();
  for (const r of exchangeHistory ?? []) {
    if (!latestRateByCurrency.has(r.currency_code)) {
      latestRateByCurrency.set(r.currency_code, { rate_date: r.rate_date, rate_to_base: r.rate_to_base });
    }
  }
  const currencySummary = ((companyCurrencies as unknown as RawCompanyCurrency[]) ?? [])
    .filter((cc) => cc.currencies)
    .map((cc) => ({
      code: cc.currencies!.code,
      isBase: cc.is_base_currency,
      rate: latestRateByCurrency.get(cc.currencies!.code) ?? null,
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="A snapshot of assets, rental income, and pending work."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Total assets" value={totalAssets.toLocaleString()} icon={HomeIcon} href="/assets" />
        <KpiCard
          label="Total property value"
          value={formatMoney(totalPropertyValue)}
          icon={BuildingIcon}
          href="/reports/asset-register"
        />
        <KpiCard
          label="Rental income (month)"
          value={formatMoney(monthlyRentalIncome)}
          icon={TrendingUpIcon}
          href="/reports/rental-income"
        />
        <KpiCard
          label="Rental income (year)"
          value={formatMoney(yearlyRentalIncome)}
          icon={TrendingUpIcon}
          href="/reports/rental-income"
        />
        <KpiCard
          label="Outstanding rent"
          value={formatMoney(totalOutstandingRent)}
          icon={WalletIcon}
          tone={totalOutstandingRent > 0 ? "warning" : undefined}
          href="/reports/outstanding-rent"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard
          label="Pending approvals"
          value={(pendingApprovals ?? 0).toLocaleString()}
          subtext="Vouchers awaiting an approval decision"
          icon={AlertCircleIcon}
          tone={(pendingApprovals ?? 0) > 0 ? "warning" : undefined}
          href="/accounting/voucher-register"
        />
        <Link href="/admin/exchange-rates" className="block rounded-xl">
          <Card className="h-full transition-colors hover:border-ring hover:bg-accent/40">
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Currency summary</CardTitle>
              <ClockIcon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-1">
              {currencySummary.length === 0 && (
                <p className="text-sm text-muted-foreground">No currencies configured.</p>
              )}
              {currencySummary.map((c) => (
                <div key={c.code} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    {c.code}
                    {c.isBase && (
                      <Badge variant="outline" className="text-xs">
                        Base
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {c.isBase ? "1.000000" : c.rate ? `${c.rate.rate_to_base} (${c.rate.rate_date})` : "No rate yet"}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/reports/asset-register" className="block rounded-xl">
          <Card className="h-full transition-colors hover:border-ring hover:bg-accent/40">
            <CardHeader>
              <CardTitle>Assets by country</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleBarChart rows={assetsByCountry} />
            </CardContent>
          </Card>
        </Link>
        <Link href="/reports/asset-register" className="block rounded-xl">
          <Card className="h-full transition-colors hover:border-ring hover:bg-accent/40">
            <CardHeader>
              <CardTitle>Assets by property type</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleBarChart rows={assetsByPropertyType} />
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
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
